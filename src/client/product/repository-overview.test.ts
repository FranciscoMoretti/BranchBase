import { expect, test } from "bun:test";

import type { AppGroupSnapshot } from "../../project/worktree-status-contract";
import {
  overviewWorktrees,
  worktreeNeedsAttention,
} from "./repository-overview";
import { worktree } from "./test-fixtures";

const runningGroup: AppGroupSnapshot = {
  apps: [],
  health: "running",
  id: "web",
  instance: { id: "web", mode: "per-worktree", name: "main" },
  instances: [],
  name: "web",
  processRunning: true,
  stop: "process",
};
const runningWorktree = { ...worktree, appGroups: [runningGroup] };

test("overview includes pending and active worktrees but leaves stopped inventory to Worktrees", () => {
  const stopped = {
    ...worktree,
    appGroups: worktree.appGroups.map((group) => ({
      ...group,
      health: "not-running" as const,
      processRunning: false,
    })),
    id: "stopped",
    setupState: "idle" as const,
  };
  const pending = { ...stopped, id: "pending", setupState: "running" as const };
  const active = { ...runningWorktree, id: "active" };
  expect(
    overviewWorktrees([stopped, pending, active]).map((item) => item.id)
  ).toEqual(["pending", "active"]);
});

test("overview stays bounded while attention includes stopped failed setup", () => {
  const active = Array.from({ length: 6 }, (_, index) => ({
    ...runningWorktree,
    id: String(index),
  }));
  expect(overviewWorktrees(active)).toHaveLength(4);
  expect(worktreeNeedsAttention({ ...worktree, setupState: "failed" })).toBe(
    true
  );
});
