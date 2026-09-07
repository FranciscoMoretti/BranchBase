import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import pathModule from "node:path";

import { z } from "zod";

import { DevelopmentFolderSchema } from "./discovery-contract";
import type { Observation as RepositoryObservation } from "./discovery-contract";
import { ActivityEventSchema, ProjectRecordSchema } from "./product-contract";
import type { ActivityEvent, AppPin } from "./product-contract";
import type {
  AppGroupSnapshot,
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "./workspace-snapshot";

const StoreSchema = z.strictObject({
  folders: z.array(DevelopmentFolderSchema).default([]),
  excludedPaths: z.array(z.string()).default([]),
  detected: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  events: z.array(ActivityEventSchema).default([]),
  observations: z
    .record(z.string(), z.record(z.string(), z.string()))
    .default({}),
  projects: z.array(ProjectRecordSchema),
  version: z.literal(1),
});

export class ProductCatalogError extends Error {
  readonly code = "invalid_product_catalog";
  readonly file: string;
  readonly cause: unknown;

  constructor(file: string, cause: unknown) {
    super(
      `BranchBase could not read a valid project catalog at ${file}. ` +
        "The file was left unchanged; repair or restore it before retrying."
    );
    this.file = file;
    this.cause = cause;
    this.name = "ProductCatalogError";
  }
}

function observedStatus(group: AppGroupSnapshot): string {
  if (
    group.apps.some(
      (app) =>
        app.protocol === "http" &&
        app.readiness === "ready" &&
        (app.routeState === "conflict" || app.routeState === "unavailable")
    )
  ) {
    return "Partial";
  }
  if (group.health === "running") {
    return "Running";
  }
  return group.processRunning || group.health === "partially-running"
    ? "Partial"
    : "Stopped";
}

/** Product metadata is separate from runtime ownership and never authorizes commands. */
export class ProductStore {
  private readonly file: string;
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    this.file = pathModule.join(directory, "product.json");
  }
  private read(): z.infer<typeof StoreSchema> {
    if (!existsSync(this.file)) {
      return StoreSchema.parse({
        events: [],
        observations: {},
        projects: [],
        version: 1,
      });
    }
    try {
      return StoreSchema.parse(JSON.parse(readFileSync(this.file, "utf-8")));
    } catch (error) {
      throw new ProductCatalogError(this.file, error);
    }
  }
  private write(value: z.infer<typeof StoreSchema>): void {
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  projects() {
    return this.read().projects;
  }
  saveProject(path: string, name: string, pins?: AppPin[]): void {
    const state = this.read();
    state.excludedPaths = state.excludedPaths.filter((value) => value !== path);
    const existing = state.projects.find((project) => project.path === path);
    const record = ProjectRecordSchema.parse({
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      name,
      path,
      pins: pins ?? existing?.pins ?? [],
    });
    state.projects = existing
      ? state.projects.map((project) =>
          project.path === path ? record : project
        )
      : [...state.projects, record];
    this.write(state);
  }
  removeProject(path: string): void {
    const state = this.read();
    state.excludedPaths = [...new Set([...state.excludedPaths, path])];
    state.projects = state.projects.filter((project) => project.path !== path);
    this.write(state);
  }
  folders() {
    return this.read().folders;
  }
  excludedPaths() {
    return this.read().excludedPaths;
  }
  saveFolder(path: string) {
    const state = this.read();
    if (state.folders.some((folder) => folder.path === path)) {
      return;
    }
    if (state.folders.length >= 20) {
      throw new Error(
        "You can watch up to 20 development folders. Remove one before adding another."
      );
    }
    state.folders.push({ path, addedAt: new Date().toISOString() });
    this.write(state);
  }
  removeFolder(path: string) {
    const state = this.read();
    state.folders = state.folders.filter((folder) => folder.path !== path);
    this.write(state);
  }
  observeDetected(observation: RepositoryObservation) {
    const state = this.read();
    const previous = state.detected[observation.repoPath];
    const current: Record<string, string> = {};
    for (const worktree of observation.worktrees) {
      current[`worktree:${worktree.id}`] = worktree.branch;
      for (const service of worktree.services.filter((item) => !item.managed)) {
        current[`service:${worktree.id}:${service.pid}:${service.port}`] =
          `${worktree.branch} · ${service.command} on port ${service.port}`;
      }
    }
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return;
    }
    if (previous) {
      for (const key of new Set([
        ...Object.keys(previous),
        ...Object.keys(current),
      ])) {
        if (previous[key] === current[key]) {
          continue;
        }
        // Configured workspace inspection already records worktree discovery.
        if (key.startsWith("worktree:") && observation.configured) {
          continue;
        }
        const action = current[key] ? "Detected" : "No longer detected";
        const worktreeId = key.split(":")[1];
        state.events.push({
          worktreeId,
          worktreeName:
            current[`worktree:${worktreeId}`] ??
            previous[`worktree:${worktreeId}`],
          id: randomUUID(),
          at: new Date().toISOString(),
          repoPath: observation.repoPath,
          kind: "discovery",
          severity: "info",
          message: `${action}: ${current[key] ?? previous[key]}`,
        });
      }
    }
    state.detected[observation.repoPath] = current;
    state.events = state.events.slice(-2000);
    this.write(state);
  }
  events(repoPath?: string): ActivityEvent[] {
    return this.read()
      .events.filter((event) => !repoPath || event.repoPath === repoPath)
      .toReversed();
  }
  append(event: Omit<ActivityEvent, "id" | "at">): void {
    const state = this.read();
    state.events.push({
      ...event,
      at: new Date().toISOString(),
      id: randomUUID(),
    });
    state.events = state.events.slice(-2000);
    this.write(state);
  }
  observe(workspace: WorkspaceSnapshot): void {
    const state = this.read();
    const previous = state.observations[workspace.repoPath];
    const current: Record<string, string> = {};
    const events: Omit<ActivityEvent, "id" | "at">[] = [];
    const observation = {
      previous,
      current,
      events,
      seen: new Set<string>(),
      repoPath: workspace.repoPath,
    };
    for (const worktree of workspace.worktrees) {
      observeWorktreeFields(worktree, observation);
      observeGroups(worktree, observation);
    }
    for (const [key, branch] of Object.entries(previous ?? {})) {
      if (key.startsWith("worktree:") && !(key in current)) {
        events.push({
          kind: "discovery",
          message: "Worktree no longer discovered",
          repoPath: workspace.repoPath,
          severity: "info",
          worktreeId: key.slice("worktree:".length),
          worktreeName: branch,
        });
      }
    }
    if (JSON.stringify(previous) === JSON.stringify(current)) {
      return;
    }
    state.observations[workspace.repoPath] = current;
    state.events.push(
      ...events.map((event) => ({
        ...event,
        at: new Date().toISOString(),
        id: randomUUID(),
      }))
    );
    state.events = state.events.slice(-2000);
    this.write(state);
  }
}

interface Observation {
  current: Record<string, string>;
  events: Omit<ActivityEvent, "id" | "at">[];
  previous: Record<string, string> | undefined;
  repoPath: string;
  seen: Set<string>;
}
function observeWorktreeFields(
  worktree: WorktreeSnapshot,
  observation: Observation
): void {
  const { previous, current, events, repoPath } = observation;
  const key = `worktree:${worktree.id}`;
  current[key] = worktree.branch;
  if (previous && !previous[key]) {
    events.push({
      kind: "discovery",
      message: "Worktree discovered",
      repoPath,
      severity: "info",
      worktreeId: worktree.id,
      worktreeName: worktree.branch,
    });
  }
  for (const [field, value, kind, label] of [
    ["setup", worktree.setupState, "runtime", "Setup"],
    [
      "configuration",
      `${worktree.configuration.revision}:${worktree.configuration.trusted}`,
      "configuration",
      "Configuration or command approval changed",
    ],
  ] as const) {
    const fieldKey = `${field}:${worktree.id}`;
    current[fieldKey] = value;
    if (previous?.[fieldKey] && previous[fieldKey] !== value) {
      events.push({
        kind,
        message:
          field === "setup"
            ? `${label}: ${value === "idle" ? "finished" : value}`
            : label,
        repoPath,
        severity: value === "failed" ? "warning" : "info",
        worktreeId: worktree.id,
        worktreeName: worktree.branch,
      });
    }
  }
}
function observeGroups(
  worktree: WorktreeSnapshot,
  observation: Observation
): void {
  const { previous, current, events, seen, repoPath } = observation;
  for (const group of worktree.appGroups) {
    if (seen.has(group.instance.id)) {
      continue;
    }
    seen.add(group.instance.id);
    const groupKey = `instance:${group.instance.id}`;
    const status = observedStatus(group);
    current[groupKey] = status;
    if (
      previous &&
      previous[groupKey] !== status &&
      (previous[groupKey] || status !== "Stopped")
    ) {
      events.push({
        groupId: group.id,
        kind: "runtime",
        message: `${group.name}: ${status}`,
        repoPath,
        severity: status === "Partial" ? "warning" : "info",
        worktreeId: worktree.id,
        worktreeName: worktree.branch,
      });
    }
  }
}
