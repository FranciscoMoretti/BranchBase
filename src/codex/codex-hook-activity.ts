import { existsSync } from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

import { z } from "zod";

import type {
  CodexIntegrationAdapterSnapshot,
  CodexTaskActivitySnapshot,
} from "./codex-integration";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-json-file";

export const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

export interface CodexHookObservation {
  agentId?: string;
  agentType?: string;
  cwd: string;
  event: CodexHookEvent;
  permissionMode?: string;
  sessionId: string;
  source?: "startup" | "resume" | "clear" | "compact";
  turnId?: string;
  version: 1;
}

interface ActivityRecord {
  activeSubagents: Set<string>;
  cwd: string;
  lastEventKey?: string;
  observedAt: Date;
  sessionId: string;
  state: Exclude<CodexTaskActivitySnapshot["state"], "unknown">;
}

const PersistedActivitySchema = z.object({
  records: z
    .array(
      z.object({
        activeSubagents: z.array(z.string().min(1).max(512)).max(100),
        cwd: z.string().min(1).max(4096),
        lastEventKey: z.string().min(1).max(1200).optional(),
        observedAt: z.iso.datetime({ offset: true }),
        sessionId: z.string().min(1).max(512),
        state: z.enum(["working", "waiting-for-approval", "ready"]),
      })
    )
    .max(1000),
  version: z.literal(1),
});

const ACTIVITY_TTL_MS: Record<ActivityRecord["state"], number> = {
  ready: 24 * 60 * 60 * 1000,
  "waiting-for-approval": 60 * 60 * 1000,
  working: 15 * 60 * 1000,
};

const activityKey = (cwd: string, sessionId: string): string =>
  `${cwd}\0${sessionId}`;

const observationKey = (
  observation: CodexHookObservation
): string | undefined => {
  if (!observation.turnId) {
    return undefined;
  }
  return [
    observation.turnId,
    observation.event,
    observation.agentId ?? "",
  ].join("\0");
};

const nextState = (
  event: CodexHookEvent,
  source?: CodexHookObservation["source"]
): ActivityRecord["state"] | undefined => {
  if (event === "UserPromptSubmit" || event === "PostToolUse") {
    return "working";
  }
  if (event === "PermissionRequest") {
    return "waiting-for-approval";
  }
  if (event === "SessionStart" && source === "compact") {
    return undefined;
  }
  if (event === "SessionStart" || event === "Stop") {
    return "ready";
  }
  return undefined;
};

const activeSubagentsFor = (
  previous: ActivityRecord | undefined,
  observation: CodexHookObservation
): Set<string> => {
  const activeSubagents = new Set(previous?.activeSubagents);
  if (observation.event === "SubagentStart" && observation.agentId) {
    activeSubagents.add(observation.agentId);
  }
  if (observation.event === "SubagentStop" && observation.agentId) {
    activeSubagents.delete(observation.agentId);
  }
  if (
    observation.event === "Stop" ||
    (observation.event === "SessionStart" && observation.source !== "compact")
  ) {
    activeSubagents.clear();
  }
  return activeSubagents;
};

export class CodexHookActivityStore {
  private readonly file: string | null;
  private readonly records = new Map<string, ActivityRecord>();

  constructor(options: { file?: string; persist?: boolean } = {}) {
    this.file =
      options.persist === false
        ? null
        : (options.file ??
          pathModule.join(homedir(), ".branchbase", "codex", "activity.json"));
    this.load();
  }

  private load(): void {
    if (!(this.file && existsSync(this.file))) {
      return;
    }
    try {
      const persisted = PersistedActivitySchema.parse(
        readPrivateJsonFile(this.file)
      );
      for (const record of persisted.records) {
        this.records.set(activityKey(record.cwd, record.sessionId), {
          ...record,
          activeSubagents: new Set(record.activeSubagents),
          observedAt: new Date(record.observedAt),
        });
      }
    } catch {
      this.records.clear();
    }
  }

  private persist(): void {
    if (!this.file) {
      return;
    }
    writePrivateJsonFile(this.file, {
      records: [...this.records.values()].slice(-1000).map((record) => ({
        ...record,
        activeSubagents: [...record.activeSubagents].slice(0, 100),
        observedAt: record.observedAt.toISOString(),
      })),
      version: 1,
    });
  }

  observe(observation: CodexHookObservation, observedAt = new Date()): void {
    const key = activityKey(observation.cwd, observation.sessionId);
    const previous = this.records.get(key);
    const lastEventKey = observationKey(observation);
    if (lastEventKey && previous?.lastEventKey === lastEventKey) {
      return;
    }
    const state =
      nextState(observation.event, observation.source) ??
      previous?.state ??
      "ready";
    const activeSubagents = activeSubagentsFor(previous, observation);
    if (!(previous || this.records.size < 1000)) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey) {
        this.records.delete(oldestKey);
      }
    }
    this.records.set(key, {
      activeSubagents,
      cwd: observation.cwd,
      ...(lastEventKey ? { lastEventKey } : {}),
      observedAt,
      sessionId: observation.sessionId,
      state,
    });
    try {
      this.persist();
    } catch {
      // Live activity remains available in memory when persistence is unavailable.
    }
  }

  discard(cwd: string, sessionId: string): void {
    if (!this.records.delete(activityKey(cwd, sessionId))) {
      return;
    }
    try {
      this.persist();
    } catch {
      // Unmatched activity is still discarded from the live in-memory view.
    }
  }

  applyToSnapshot(
    snapshot: CodexIntegrationAdapterSnapshot,
    now = new Date(),
    enabled: (worktreePath: string) => boolean = () => true
  ): CodexIntegrationAdapterSnapshot {
    return {
      ...snapshot,
      tasks: snapshot.tasks.map(({ task, worktreePath }) => {
        if (!enabled(worktreePath)) {
          return { task, worktreePath };
        }
        const record = this.records.get(activityKey(worktreePath, task.id));
        if (!record) {
          return { task, worktreePath };
        }
        const expired =
          now.getTime() - record.observedAt.getTime() >
          ACTIVITY_TTL_MS[record.state];
        return {
          task: {
            ...task,
            activity: {
              observedAt: record.observedAt.toISOString(),
              state: expired ? "unknown" : record.state,
              subagentCount: expired ? 0 : record.activeSubagents.size,
            },
          },
          worktreePath,
        };
      }),
    };
  }
}
