import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";

export type AppGroupDisplayStatus = "partial" | "running" | "stopped";
export type WorktreeDisplayStatus =
  | AppGroupDisplayStatus
  | "setup-failed"
  | "setting-up";

export const appGroupDisplayStatus = (
  group: Pick<AppGroupSnapshot, "apps" | "health" | "processRunning">
): AppGroupDisplayStatus => {
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
  if (group.health === "partially-running" || group.processRunning) {
    return "partial";
  }
  return "stopped";
};

export const worktreeDisplayStatus = (
  worktree: Pick<
    WorktreeSnapshot,
    "health" | "processRunning" | "setupState"
  > & {
    appGroups: Pick<AppGroupSnapshot, "apps" | "health" | "processRunning">[];
  }
): WorktreeDisplayStatus => {
  if (worktree.setupState === "failed") {
    return "setup-failed";
  }
  if (worktree.setupState === "running") {
    return "setting-up";
  }
  const groupStatuses = new Set(worktree.appGroups.map(appGroupDisplayStatus));
  if (
    worktree.health === "partially-running" ||
    groupStatuses.has("partial") ||
    (worktree.processRunning && worktree.health !== "running")
  ) {
    return "partial";
  }
  if (worktree.health === "running" || groupStatuses.has("running")) {
    return "running";
  }
  return "stopped";
};
