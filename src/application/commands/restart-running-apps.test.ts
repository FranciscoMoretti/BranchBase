import { describe, expect, it } from "bun:test";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";
import type { WorkspaceController } from "../workspace-controller";
import { restartRunningApps } from "./restart-running-apps";
import { findAppGroup } from "./start-apps";

const group = (id: string): AppGroupSnapshot => ({
  apps: [],
  health: "running",
  id,
  instance: { id: `${id}-main`, mode: "per-worktree", name: "main" },
  instances: [{ id: `${id}-main`, name: "main", running: true }],
  name: "Shared display name",
  processRunning: true,
  stop: "process",
});

const worktree = (): WorktreeSnapshot => ({
  appGroups: [group("first"), group("second")],
  appLabel: "Apps",
  apps: [],
  branch: "main",
  configuration: {
    changeBlocked: false,
    error: null,
    path: "/repo/.branchbase.json",
    preference: "project-default",
    revision: "default-revision",
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
  primaryAppGroup: "first",
  processRunning: true,
  setupState: "idle",
});

const fakeController = (
  target: WorktreeSnapshot
): {
  controller: WorkspaceController;
  restarts: string[];
  starts: string[];
  stops: string[];
} => {
  const starts: string[] = [];
  const stops: string[] = [];
  const restarts: string[] = [];
  const controller = {
    inspect: () => ({ worktrees: [target] }),
    restartAppGroup: (_repo: string, _worktree: string, id: string) => {
      restarts.push(id);
      const item = findAppGroup(target, id);
      item.health = "running";
      item.processRunning = true;
      return Promise.resolve("restarted" as const);
    },
    startAppGroup: (_repo: string, _worktree: string, id: string) => {
      starts.push(id);
      const item = findAppGroup(target, id);
      item.health = "running";
      item.processRunning = true;
      return Promise.resolve("started" as const);
    },
    stopAppGroup: (_repo: string, _worktree: string, id: string) => {
      stops.push(id);
      const item = findAppGroup(target, id);
      item.health = "not-running";
      item.processRunning = false;
      return Promise.resolve("stopped" as const);
    },
    worktree: () => ({ worktree: target }),
  } as unknown as WorkspaceController;
  return { controller, restarts, starts, stops };
};

describe("restart running App groups", () => {
  it("targets every stable ID even when display names collide", async () => {
    const target = worktree();
    const fake = fakeController(target);

    await restartRunningApps(fake.controller, {
      repoPath: "/repo",
      worktreeIds: [target.id],
    });

    expect(fake.restarts).toEqual(["first", "second"]);
  });

  it("filters by stable ID rather than display name", async () => {
    const target = worktree();
    const fake = fakeController(target);

    await restartRunningApps(fake.controller, {
      appGroupName: "second",
      repoPath: "/repo",
      worktreeIds: [target.id],
    });

    expect(fake.restarts).toEqual(["second"]);
  });

  it("does not continue to a later group after an atomic restart fails", async () => {
    const target = worktree();
    const fake = fakeController(target);
    fake.controller.restartAppGroup = ((_repo, _worktree, id) => {
      fake.restarts.push(id);
      return Promise.reject(new Error("restart failed"));
    }) as typeof fake.controller.restartAppGroup;

    await expect(
      restartRunningApps(fake.controller, {
        repoPath: "/repo",
        worktreeIds: [target.id],
      })
    ).rejects.toThrow("restart failed");
    expect(fake.restarts).toEqual(["first"]);
  });

  it("does not resolve ambiguous display names as command identities", () => {
    const target = worktree();
    expect(findAppGroup(target, "first").id).toBe("first");
    expect(() => findAppGroup(target, "Shared display name")).toThrow(
      "Unknown App group"
    );
  });
});
