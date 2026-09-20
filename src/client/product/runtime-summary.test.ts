import { expect, test } from "bun:test";

import type { AppGroupSnapshot } from "../../project/worktree-status-contract";
import { runtimeSummary } from "./runtime-summary";
import { worktree } from "./test-fixtures";

const group = (health: AppGroupSnapshot["health"]): AppGroupSnapshot => ({
  apps: [],
  health,
  id: health,
  instance: { id: health, mode: "per-worktree", name: "main" },
  instances: [],
  name: health,
  processRunning: health !== "not-running",
  stop: "process",
});
test("a running app group cannot hide a stopped sibling in worktree navigation", () => {
  const summary = runtimeSummary({
    ...worktree,
    appGroups: [group("running"), group("not-running")],
    health: "running",
  });
  expect(summary.label).toBe("Partially running");
  expect(summary.value).toBe("partial");
});
test("setup failures and setup in progress take precedence over endpoint readiness", () => {
  const data = {
    ...worktree,
    appGroups: [group("running")],
    health: "running" as const,
  };
  expect(runtimeSummary({ ...data, setupState: "failed" }).label).toBe(
    "Setup failed"
  );
  expect(runtimeSummary({ ...data, setupState: "running" }).label).toBe(
    "Setting up"
  );
});
test("endpoint readiness does not claim a conflicting route is healthy", () => {
  const data = {
    ...group("running"),
    apps: [{ ...worktree.apps[0], routeState: "conflict" as const }],
  };
  expect(
    runtimeSummary({ ...worktree, appGroups: [data], health: "running" })
  ).toEqual({
    label: "Partially running",
    ready: 1,
    total: 1,
    value: "partial",
  });
});
