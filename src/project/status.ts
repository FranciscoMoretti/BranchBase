import path from "node:path";

import { git, resolveWorktrees } from "../adapters/git/project-worktrees";
import { inspectListeningPorts } from "../adapters/host/ports";
import { resolveProjectConfiguration } from "../configuration/resolution";
import { readConfiguredStatus } from "./configured-status";
import type { StatusDependencies } from "./configured-status";
import type { Observation } from "./discovery-contract";
import type {
  ProjectStatus,
  ProjectStatusWorktree,
  RetainedCleanupTarget,
} from "./status-contract";
import type {
  AppGroupSnapshot,
  WorkspaceSnapshot,
} from "./worktree-status-contract";

export interface ProjectStatusInput {
  repoPath: string;
  worktrees: ProjectStatusWorktree[];
  workspace: WorkspaceSnapshot | null;
  configurationError?: string | null;
  cleanupAppGroups?: AppGroupSnapshot[];
  retainedCleanupTargets?: RetainedCleanupTarget[];
  observation?: Observation | null;
  issues?: ProjectStatus["issues"];
}

/**
 * Builds the stable Project status envelope shared by all interaction
 * adapters. The configured worktree details are one optional section, not a
 * prerequisite for displaying Git facts or retained cleanup targets.
 */
export const createProjectStatus = ({
  repoPath,
  worktrees,
  workspace,
  configurationError = null,
  cleanupAppGroups = [],
  retainedCleanupTargets = [],
  observation = null,
  issues = [],
}: ProjectStatusInput): ProjectStatus => {
  let state: ProjectStatus["configuration"]["state"] = "unconfigured";
  if (workspace) {
    state = "ready";
  } else if (configurationError) {
    state = "invalid";
  }

  return {
    cleanupAppGroups,
    configuration: { error: configurationError, state },
    issues,
    observation,
    repoName: path.basename(repoPath),
    repoPath,
    retainedCleanupTargets,
    updatedAt: new Date().toISOString(),
    workspace,
    worktrees,
  };
};

/** Read-only collection. Identity reconciliation and history recording are explicit application work. */
export const readProjectStatus = (
  repoPath: string,
  dependencies: StatusDependencies & {
    observe: (path: string) => Observation;
    inspectPorts?: typeof inspectListeningPorts;
  }
): ProjectStatus => {
  const discovered = resolveWorktrees(
    git(repoPath, ["rev-parse", "--show-toplevel"])
  );
  const root = discovered[0]?.path;
  if (!root) {
    throw new Error("No Git worktrees were discovered");
  }
  const issues: ProjectStatus["issues"] = [];
  const report = (
    area: ProjectStatus["issues"][number]["area"],
    error: unknown
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({ area, code: `${area}-unavailable`, message });
    return message;
  };
  let observation: Observation | null = null;
  try {
    observation = dependencies.observe(root);
    if (observation.warning) {
      report("observation", observation.warning);
    }
  } catch (error) {
    report("observation", error);
  }
  let configurationError: string | null = null;
  let configurationReady = false;
  try {
    configurationReady = resolveProjectConfiguration(root) !== null;
  } catch (error) {
    configurationError = report("configuration", error);
  }
  let workspace: WorkspaceSnapshot | null = null;
  if (configurationReady) {
    try {
      workspace = readConfiguredStatus(root, dependencies);
    } catch (error) {
      report("runtime", error);
    }
  }
  const cleanupAppGroups: AppGroupSnapshot[] = [];
  const retainedCleanupTargets: RetainedCleanupTarget[] = [];
  if (!workspace) {
    let retainedInstances: {
      instance: ReturnType<
        StatusDependencies["state"]["runningInstancesForWorktree"]
      >[number];
      worktreePath: string;
    }[] = [];
    try {
      retainedInstances = discovered.flatMap((worktree) =>
        dependencies.state
          .runningInstancesForWorktree(root, worktree.path)
          .map((instance) => ({ instance, worktreePath: worktree.path }))
      );
    } catch (error) {
      report("runtime", error);
    }
    for (const { instance, worktreePath } of retainedInstances) {
      retainedCleanupTargets.push({
        groupId: instance.groupId,
        instanceId: instance.id,
        name: instance.name,
        worktreePath,
      });
    }
    if (retainedInstances.length > 0) {
      try {
        const ports = (dependencies.inspectPorts ?? inspectListeningPorts)();
        for (const { instance } of retainedInstances) {
          try {
            cleanupAppGroups.push(
              dependencies.appGroups.inspectDetached(root, instance, ports)
            );
          } catch (error) {
            report("runtime", error);
          }
        }
      } catch (error) {
        report("runtime", error);
      }
    }
  }
  const result = createProjectStatus({
    cleanupAppGroups,
    configurationError,
    issues,
    observation,
    repoPath: root,
    retainedCleanupTargets,
    workspace,
    worktrees: discovered.map((item, index) => ({
      branch: item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
      id: item.id,
      isMain: index === 0,
      path: item.path,
    })),
  });
  // Configuration validity is independent of host/runtime observation availability.
  if (configurationReady) {
    result.configuration.state = "ready";
  }
  return result;
};
