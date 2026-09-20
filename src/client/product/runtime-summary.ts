import { appGroupStatus, worktreeStatus } from "../../app-group/status";
import type {
  AppEndpointSnapshot,
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";

export const runtimeSummary = (worktree: WorktreeSnapshot) => {
  const apps = worktree.appGroups.flatMap((group) => group.apps);
  const ready = apps.filter((app) => app.readiness === "ready").length;
  let value = worktreeStatus(worktree);
  const groups = worktree.appGroups.map(appGroupStatus);
  if (value === "running" && groups.includes("stopped")) {
    value = "partial";
  }
  const labels = {
    partial: "Partially running",
    running: "Running",
    "setting-up": "Setting up",
    "setup-failed": "Setup failed",
    stopped: "Stopped",
  };
  return { label: labels[value], ready, total: apps.length, value };
};

/** Describe observed endpoint state without inferring a process failure. */
export const endpointRuntime = (
  app: AppEndpointSnapshot,
  group: AppGroupSnapshot
) => {
  if (app.ownership === "foreign") {
    return { label: "Port in use by another process", value: "partial" };
  }
  if (app.readiness === "ready") {
    if (app.protocol === "http" && app.routeState === "conflict") {
      return { label: "Route conflict", value: "partial" };
    }
    if (app.protocol === "http" && app.routeState === "unavailable") {
      return { label: "Route unavailable", value: "partial" };
    }
    return { label: "Ready", value: "running" };
  }
  if (app.readiness === "waiting" && group.processRunning) {
    return { label: "Starting · waiting for readiness", value: "partial" };
  }
  if (app.listening) {
    return { label: "Listening · not ready", value: "partial" };
  }
  if (group.processRunning) {
    return { label: "Process running · not listening", value: "partial" };
  }
  return { label: "Stopped", value: "stopped" };
};

export const groupRuntimeReasons = (group: AppGroupSnapshot): string[] => {
  if (group.cleanupOnly) {
    return ["Previous configuration · cleanup required"];
  }
  const reasons = group.apps.flatMap((app) => {
    const state = endpointRuntime(app, group);
    return state.value === "running" ? [] : [`${app.label}: ${state.label}`];
  });
  if (reasons.length || appGroupStatus(group) === "running") {
    return reasons;
  }
  return [
    `${group.name}: ${group.processRunning ? "Process running · readiness unavailable" : "Stopped"}`,
  ];
};

export const worktreeRuntimeReasons = (worktree: WorktreeSnapshot): string[] =>
  runtimeSummary(worktree).value === "partial"
    ? worktree.appGroups.flatMap(groupRuntimeReasons)
    : [];
