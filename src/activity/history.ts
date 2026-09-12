import { observedAppGroupStatus } from "../app-group/status";
import type { ActivityEvent } from "../project/catalog-contract";
import type { WorktreeSnapshot } from "../project/worktree-status-contract";

interface Observation {
  current: Record<string, string>;
  events: Omit<ActivityEvent, "id" | "at">[];
  previous: Record<string, string> | undefined;
  repoPath: string;
  seen: Set<string>;
}
export const observeWorktreeFields = (
  worktree: WorktreeSnapshot,
  observation: Observation
): void => {
  const { previous, current, events, repoPath } = observation;
  const key = `worktree:${worktree.id}`;
  current[key] = worktree.branch;
  if (previous && !previous[key]) {
    events.push({
      kind: "discovery",
      message: "Worktree discovered",
      repoPath,
      severity: "info",
      worktreeId: worktree.id,
      worktreeName: worktree.branch,
    });
  }
  for (const [field, value, kind, label] of [
    ["setup", worktree.setupState, "runtime", "Setup"],
    [
      "configuration",
      `${worktree.configuration.revision}:${worktree.configuration.trusted}`,
      "configuration",
      "Configuration or command approval changed",
    ],
  ] as const) {
    const fieldKey = `${field}:${worktree.id}`;
    current[fieldKey] = value;
    if (previous?.[fieldKey] && previous[fieldKey] !== value) {
      events.push({
        kind,
        message:
          field === "setup"
            ? `${label}: ${value === "idle" ? "finished" : value}`
            : label,
        repoPath,
        severity: value === "failed" ? "warning" : "info",
        worktreeId: worktree.id,
        worktreeName: worktree.branch,
      });
    }
  }
};
export const observeGroups = (
  worktree: WorktreeSnapshot,
  observation: Observation
): void => {
  const { previous, current, events, seen, repoPath } = observation;
  for (const group of worktree.appGroups) {
    if (seen.has(group.instance.id)) {
      continue;
    }
    seen.add(group.instance.id);
    const groupKey = `instance:${group.instance.id}`;
    const status = observedAppGroupStatus(group);
    current[groupKey] = status;
    if (
      previous &&
      previous[groupKey] !== status &&
      (previous[groupKey] || status !== "Stopped")
    ) {
      events.push({
        groupId: group.id,
        kind: "runtime",
        message: `${group.name}: ${status}`,
        repoPath,
        severity: status === "Partial" ? "warning" : "info",
        worktreeId: worktree.id,
        worktreeName: worktree.branch,
      });
    }
  }
};
