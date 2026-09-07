import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { CodexHookActivityStore } from "./codex-hook-activity";
import type { CodexIntegrationAdapterSnapshot } from "./codex-integration";

const SNAPSHOT: CodexIntegrationAdapterSnapshot = {
  tasks: [
    {
      task: {
        activity: null,
        contextSharedAt: null,
        createdAt: "2026-07-17T10:00:00.000Z",
        id: "task-a",
        title: "Lifecycle bridge",
        updatedAt: "2026-07-18T10:00:00.000Z",
      },
      worktreePath: "/repo/worktree",
    },
  ],
  updatedAt: "2026-07-18T12:00:00.000Z",
};

describe("Codex hook activity", () => {
  it("decorates only the persisted task with the same session and canonical cwd", () => {
    const store = new CodexHookActivityStore({ persist: false });

    store.observe(
      {
        cwd: "/repo/worktree",
        event: "UserPromptSubmit",
        sessionId: "task-a",
        turnId: "turn-1",
        version: 1,
      },
      new Date("2026-07-18T12:30:00.000Z")
    );

    expect(
      store.applyToSnapshot(SNAPSHOT, new Date("2026-07-18T12:31:00.000Z"))
        .tasks[0].task.activity
    ).toEqual({
      observedAt: "2026-07-18T12:30:00.000Z",
      state: "working",
      subagentCount: 0,
    });
  });

  it("tracks approval, tool, subagent, and completion transitions idempotently", () => {
    const store = new CodexHookActivityStore({ persist: false });
    const observe = (
      event:
        | "UserPromptSubmit"
        | "PermissionRequest"
        | "PostToolUse"
        | "SubagentStart"
        | "Stop",
      minute: number,
      agentId?: string
    ) =>
      store.observe(
        {
          ...(agentId ? { agentId } : {}),
          cwd: "/repo/worktree",
          event,
          sessionId: "task-a",
          turnId: "turn-1",
          version: 1,
        },
        new Date(`2026-07-18T12:${String(minute).padStart(2, "0")}:00.000Z`)
      );
    const activity = () =>
      store.applyToSnapshot(SNAPSHOT, new Date("2026-07-18T12:06:00.000Z"))
        .tasks[0].task.activity;

    observe("UserPromptSubmit", 1);
    observe("SubagentStart", 2, "agent-a");
    observe("SubagentStart", 3, "agent-a");
    expect(activity()).toMatchObject({ state: "working", subagentCount: 1 });

    observe("PermissionRequest", 4);
    expect(activity()?.state).toBe("waiting-for-approval");

    observe("PostToolUse", 5);
    expect(activity()?.state).toBe("working");

    observe("Stop", 6);
    expect(activity()).toEqual({
      observedAt: "2026-07-18T12:06:00.000Z",
      state: "ready",
      subagentCount: 0,
    });
  });

  it("does not extend freshness for a duplicate event in the same turn", () => {
    const store = new CodexHookActivityStore({ persist: false });
    const observation = {
      cwd: "/repo/worktree",
      event: "UserPromptSubmit" as const,
      sessionId: "task-a",
      turnId: "turn-1",
      version: 1 as const,
    };
    store.observe(observation, new Date("2026-07-18T12:00:00.000Z"));
    store.observe(observation, new Date("2026-07-18T12:10:00.000Z"));

    expect(
      store.applyToSnapshot(SNAPSHOT, new Date("2026-07-18T12:11:00.000Z"))
        .tasks[0].task.activity
    ).toMatchObject({ observedAt: "2026-07-18T12:00:00.000Z" });
  });

  it("derives Unknown after each activity state's freshness window", () => {
    const cases = [
      ["UserPromptSubmit", 15 * 60 * 1000],
      ["PermissionRequest", 60 * 60 * 1000],
      ["Stop", 24 * 60 * 60 * 1000],
    ] as const;

    for (const [event, ttl] of cases) {
      const store = new CodexHookActivityStore({ persist: false });
      const observedAt = new Date("2026-07-18T12:00:00.000Z");
      store.observe(
        {
          cwd: "/repo/worktree",
          event,
          sessionId: "task-a",
          version: 1,
        },
        observedAt
      );

      expect(
        store.applyToSnapshot(
          SNAPSHOT,
          new Date(observedAt.getTime() + ttl + 1)
        ).tasks[0].task.activity
      ).toEqual({
        observedAt: observedAt.toISOString(),
        state: "unknown",
        subagentCount: 0,
      });
    }
  });

  it("preserves activity across compaction and resets it on resume", () => {
    const store = new CodexHookActivityStore({ persist: false });
    store.observe({
      cwd: "/repo/worktree",
      event: "UserPromptSubmit",
      sessionId: "task-a",
      version: 1,
    });
    store.observe({
      agentId: "agent-a",
      cwd: "/repo/worktree",
      event: "SubagentStart",
      sessionId: "task-a",
      version: 1,
    });
    store.observe({
      cwd: "/repo/worktree",
      event: "SessionStart",
      sessionId: "task-a",
      source: "compact",
      version: 1,
    });
    expect(
      store.applyToSnapshot(SNAPSHOT).tasks[0].task.activity
    ).toMatchObject({ state: "working", subagentCount: 1 });

    store.observe({
      cwd: "/repo/worktree",
      event: "SessionStart",
      sessionId: "task-a",
      source: "resume",
      version: 1,
    });
    expect(
      store.applyToSnapshot(SNAPSHOT).tasks[0].task.activity
    ).toMatchObject({ state: "ready", subagentCount: 0 });
  });

  it("persists only bounded activity metadata in a private file", () => {
    const directory = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-hook-activity-")
    );
    const file = pathModule.join(directory, "codex", "activity.json");
    try {
      const writer = new CodexHookActivityStore({ file });
      writer.observe(
        {
          agentId: "agent-a",
          cwd: "/repo/worktree",
          event: "SubagentStart",
          sessionId: "task-a",
          turnId: "turn-1",
          version: 1,
        },
        new Date("2026-07-18T12:30:00.000Z")
      );

      const reader = new CodexHookActivityStore({ file });
      expect(
        reader.applyToSnapshot(SNAPSHOT, new Date("2026-07-18T12:31:00.000Z"))
          .tasks[0].task.activity
      ).toEqual({
        observedAt: "2026-07-18T12:30:00.000Z",
        state: "ready",
        subagentCount: 1,
      });
      expect(statSync(pathModule.join(directory, "codex")).mode % 0o1000).toBe(
        0o700
      );
      expect(statSync(file).mode % 0o1000).toBe(0o600);

      writer.discard("/repo/worktree", "task-a");
      expect(
        new CodexHookActivityStore({ file }).applyToSnapshot(SNAPSHOT).tasks[0]
          .task.activity
      ).toBeNull();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("keeps live activity in memory when persistence is unavailable", () => {
    const directory = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-hook-memory-")
    );
    const blockedDirectory = pathModule.join(directory, "blocked");
    try {
      writeFileSync(blockedDirectory, "not a directory");
      const store = new CodexHookActivityStore({
        file: pathModule.join(blockedDirectory, "activity.json"),
      });

      expect(() =>
        store.observe({
          cwd: "/repo/worktree",
          event: "UserPromptSubmit",
          sessionId: "task-a",
          version: 1,
        })
      ).not.toThrow();
      expect(
        store.applyToSnapshot(SNAPSHOT).tasks[0].task.activity?.state
      ).toBe("working");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
