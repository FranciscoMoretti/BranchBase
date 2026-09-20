import { appGroupStatus, worktreeStatus } from "../../app-group/status";
import type { ProjectOverview } from "../../project/catalog-contract";
import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type { WorktreeSnapshot } from "../../project/worktree-status-contract";

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

export const runningGroupCount = (projects: ProjectOverview[]) =>
  projects.reduce(
    (total, project) =>
      total +
      new Set(
        project.workspace?.worktrees.flatMap((worktree) =>
          worktree.appGroups
            .filter(appGroupIsRunning)
            .map((group) => group.instance.id)
        )
      ).size,
    0
  );
