import type { Observation } from "../../project/discovery-contract";
import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";

interface RuntimeSource {
  path: string;
  workspace?: Pick<WorkspaceSnapshot, "worktrees"> | null;
  observation?: Pick<Observation, "worktrees"> | null;
}

export const runtimeCounts = (projects: RuntimeSource[]) => {
  const groups = new Set<string>();
  const detected = new Set<string>();
  for (const project of projects) {
    for (const worktree of project.workspace?.worktrees ?? []) {
      for (const group of worktree.appGroups) {
        if (appGroupIsRunning(group)) {
          groups.add(JSON.stringify([project.path, group.instance.id]));
        }
      }
    }
    for (const worktree of project.observation?.worktrees ?? []) {
      for (const service of worktree.services) {
        if (!service.managed) {
          detected.add(`${service.pid}:${service.port}`);
        }
      }
    }
  }
  return { detectedServices: detected.size, managedGroups: groups.size };
};
