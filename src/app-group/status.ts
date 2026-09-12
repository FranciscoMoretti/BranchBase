import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../project/worktree-status-contract";

export type AppGroupStatus = "partial" | "running" | "stopped";
export type WorktreeStatus = AppGroupStatus | "setup-failed" | "setting-up";

export const appGroupStatus = (
  group: Pick<AppGroupSnapshot, "apps" | "health" | "processRunning">
): AppGroupStatus => {
  if (
    group.apps.some(
      (app) =>
        app.protocol === "http" &&
        app.readiness === "ready" &&
        (app.routeState === "conflict" || app.routeState === "unavailable")
    )
  ) {
    return "partial";
  }
  if (group.health === "running") {
    return "running";
  }
  return group.health === "partially-running" || group.processRunning
    ? "partial"
    : "stopped";
};

export const worktreeStatus = (
  worktree: Pick<
    WorktreeSnapshot,
    "health" | "processRunning" | "setupState"
  > & {
    appGroups: Pick<AppGroupSnapshot, "apps" | "health" | "processRunning">[];
  }
): WorktreeStatus => {
  if (worktree.setupState === "failed") {
    return "setup-failed";
  }
  if (worktree.setupState === "running") {
    return "setting-up";
  }
  const groups = new Set(worktree.appGroups.map(appGroupStatus));
  if (
    worktree.health === "partially-running" ||
    groups.has("partial") ||
    (worktree.processRunning && worktree.health !== "running")
  ) {
    return "partial";
  }
  return worktree.health === "running" || groups.has("running")
    ? "running"
    : "stopped";
};

export const observedAppGroupStatus = (
  group: Pick<AppGroupSnapshot, "apps" | "health" | "processRunning">
): "Partial" | "Running" | "Stopped" => {
  const status = appGroupStatus(group);
  const labels = {
    partial: "Partial",
    running: "Running",
    stopped: "Stopped",
  } as const;
  return labels[status];
};
