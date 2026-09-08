import { describe, expect, it } from "bun:test";

import type { WorktreeSnapshot } from "../controller/workspace-snapshot";
import { worktreeCommandMenuItems } from "./worktree-command-menu";
import type { WorktreeCommandActions } from "./worktree-command-menu";

const actions: WorktreeCommandActions = {
  onRestart: () => undefined,
  onSetup: () => undefined,
  onStart: () => undefined,
  onStop: () => undefined,
};

const worktree = (health: WorktreeSnapshot["health"]): WorktreeSnapshot => ({
  appGroups: [
    {
      apps: [],
      health,
      id: "apps",
      instance: { id: "apps-main", mode: "per-worktree", name: "main" },
      instances: [{ id: "apps-main", name: "main", running: false }],
      name: "Apps",
      processRunning: false,
      stop: "process",
    },
  ],
  appLabel: "App",
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
  health,
  id: "worktree",
  isMain: true,
  name: "repo",
  path: "/repo",
  primaryAppGroup: "apps",
  processRunning: false,
  setupState: "idle",
});

const itemIds = (target: WorktreeSnapshot): string[] =>
  worktreeCommandMenuItems({
    actions,
    pending: false,
    worktree: target,
  }).map((item) => item.id);

describe("worktree command menu", () => {
  it("can keep lifecycle controls out of a worktree-level menu", () => {
    expect(
      worktreeCommandMenuItems({
        actions,
        includeLifecycle: false,
        pending: false,
        worktree: worktree("running"),
      }).map((item) => item.id)
    ).toEqual(["setup"]);
  });

  it("offers setup and start when stopped", () => {
    expect(itemIds(worktree("not-running"))).toEqual(["setup", "start"]);
  });

  it("offers setup, stop, and restart when partially running", () => {
    expect(itemIds(worktree("partially-running"))).toEqual([
      "setup",
      "stop",
      "restart",
    ]);
  });

  it("offers setup, stop, and restart when fully running", () => {
    expect(itemIds(worktree("running"))).toEqual(["setup", "stop", "restart"]);
  });
});
