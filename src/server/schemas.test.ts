import { describe, expect, it } from "bun:test";

import { CodexIntegrationSnapshotSchema } from "../codex/codex-integration";
import {
  AppGroupSnapshotSchema,
  WorkspaceSnapshotSchema,
} from "../controller/workspace-snapshot";

describe("workspace snapshot transport schema", () => {
  it("preserves slot-free App groups and endpoint lifecycle state", () => {
    const snapshot = WorkspaceSnapshotSchema.parse({
      globalProcesses: [],
      globalRunningCount: 1,
      mainWorktreePath: "/repo",
      projectDefaultConfig: {
        appGroups: {
          product: {
            apps: { web: { protocol: "http", readiness: "tcp" } },
            name: "Product Apps",
            start: { argv: ["bun", "run", "dev"] },
            stop: "process",
          },
        },
        setup: { argv: ["bun", "install"] },
        version: 1,
      },
      projectDefaultConfigPath: "/repo/.branchbase.json",
      projectDefaultConfigRevision: "revision",
      projectDefaultPrimaryAppGroup: "product",
      repoName: "repo",
      repoPath: "/repo",
      trustCommands: [],
      trustFingerprint: "default-fingerprint",
      trustRequired: true,
      trusted: true,
      updatedAt: "2026-07-14T00:00:00.000Z",
      worktrees: [
        {
          appGroups: [
            {
              apps: [
                {
                  directUrl: "http://127.0.0.1:49152",
                  id: "web",
                  label: "web",
                  listening: true,
                  open: true,
                  ownership: "owned",
                  port: 49_152,
                  protocol: "http",
                  readiness: "ready",
                  routeState: "active",
                  url: "http://web.main.repo.localhost:1355",
                },
              ],
              health: "running",
              id: "product",
              instance: {
                id: "product-main",
                mode: "per-worktree",
                name: "main",
              },
              instances: [{ id: "product-main", name: "main", running: true }],
              name: "Product Apps",
              processRunning: true,
              stop: "process",
            },
          ],
          appLabel: "Product Apps",
          apps: [],
          branch: "main",
          configuration: {
            changeBlocked: true,
            error: null,
            path: "/repo/.branchbase.json",
            preference: "project-default",
            revision: "revision",
            source: "project-default",
            trustCommands: [],
            trustFingerprint: "default-fingerprint",
            trusted: true,
          },
          health: "running",
          id: "worktree",
          isMain: true,
          name: "repo",
          path: "/repo",
          primaryAppGroup: "product",
          processRunning: true,
          setupState: "idle",
        },
      ],
    });

    expect(snapshot.worktrees[0]?.appGroups[0]?.apps[0]?.routeState).toBe(
      "active"
    );
    expect(snapshot.worktrees[0]?.appGroups[0]?.instance.id).toBe(
      "product-main"
    );
  });

  it("rejects unexpected fields in runtime context objects", () => {
    const appGroup = {
      apps: [],
      health: "not-running" as const,
      id: "product",
      instance: {
        id: "product-main",
        mode: "per-worktree" as const,
        name: "main",
      },
      instances: [{ id: "product-main", name: "main", running: false }],
      name: "Product Apps",
      processRunning: false,
      stop: "process" as const,
    };

    expect(
      AppGroupSnapshotSchema.safeParse({
        ...appGroup,
        run: { startedAt: "now", unexpected: true, worktreePath: "/repo" },
      }).success
    ).toBe(false);
    expect(
      AppGroupSnapshotSchema.safeParse({
        ...appGroup,
        dependencies: [
          {
            extra: true,
            groupId: "infra",
            instanceId: "main",
            name: "Database",
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe("Codex integration transport schema", () => {
  it("preserves only the agreed task metadata and activity", () => {
    const snapshot = CodexIntegrationSnapshotSchema.parse({
      updatedAt: "2026-07-18T13:00:00.000Z",
      worktrees: {
        worktree: {
          tasks: [
            {
              activity: {
                observedAt: "2026-07-18T12:30:00.000Z",
                state: "waiting-for-approval",
                subagentCount: 1,
              },
              contextSharedAt: "2026-07-18T12:00:00.000Z",
              createdAt: "2026-07-17T10:00:00.000Z",
              id: "task-a",
              preview: "must not cross the transport seam",
              title: "Task A",
              updatedAt: "2026-07-18T12:15:00.000Z",
            },
          ],
        },
      },
    });

    expect(snapshot.worktrees.worktree.tasks[0]).toEqual({
      activity: {
        observedAt: "2026-07-18T12:30:00.000Z",
        state: "waiting-for-approval",
        subagentCount: 1,
      },
      contextSharedAt: "2026-07-18T12:00:00.000Z",
      createdAt: "2026-07-17T10:00:00.000Z",
      id: "task-a",
      title: "Task A",
      updatedAt: "2026-07-18T12:15:00.000Z",
    });
  });
});
