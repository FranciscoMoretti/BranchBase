import pathModule from "node:path";

import { git, resolveWorktrees } from "../adapters/git/project-worktrees";
import { inspectListeningPorts } from "../adapters/host/ports";
import {
  appGroupInstanceProcessId,
  setupProcessId,
} from "../adapters/host/process-supervisor";
import type { ProcessSupervisor } from "../adapters/host/process-supervisor";
import {
  inspectProcessSamples,
  processTreeUsage,
} from "../adapters/host/process-usage";
import type { FileBranchBaseStateStore } from "../app-group/assignments";
import type { AppGroupRuntime } from "../app-group/lifecycle";
import type { BranchBaseCommand } from "../configuration/branchbase-command";
import type { BranchBaseConfig } from "../configuration/branchbase-schema";
import { MissingWorktreeConfigError } from "../configuration/missing-config-error";
import {
  repositoryCommandFingerprint,
  repositoryIsTrusted,
  repositoryRequiresTrust,
} from "../configuration/repository-trust";
import {
  resolveProjectConfiguration,
  resolveWorktreeConfiguration,
} from "../configuration/resolution";
import type { WorkspaceSnapshot } from "./worktree-status-contract";

export interface StatusDependencies {
  state: Pick<
    FileBranchBaseStateStore,
    "worktreeConfigSource" | "runningInstancesForWorktree" | "hasRunForWorktree"
  >;
  appGroups: Pick<AppGroupRuntime, "inspect" | "inspectDetached">;
  processes: Pick<
    ProcessSupervisor,
    | "controlDirectory"
    | "managedPid"
    | "managedFailure"
    | "listManagedProcesses"
  >;
}

const commandSummary = (label: string, command: BranchBaseCommand): string =>
  `${label}: ${command.argv.join(" ")}`;

const worktreeSetupState = (
  id: string,
  path: string,
  processes: Pick<ProcessSupervisor, "managedPid" | "managedFailure">
): "failed" | "idle" | "running" => {
  const processId = setupProcessId(id);
  if (processes.managedPid(processId, path) !== null) {
    return "running";
  }
  return processes.managedFailure(processId) ? "failed" : "idle";
};

const primaryAppGroup = (config: BranchBaseConfig): string => {
  const entries = Object.entries(config.appGroups);
  return (
    entries.find(([, group]) => group.stop === "process")?.[0] ?? entries[0][0]
  );
};

const displayName = (id: string, value: { name?: string }): string =>
  value.name ?? id;

const trustCommands = (config: BranchBaseConfig): string[] => [
  commandSummary("Setup", config.setup),
  ...Object.entries(config.appGroups).flatMap(([groupId, group]) => [
    commandSummary(`${displayName(groupId, group)} Start`, group.start),
    ...(group.stop === "process"
      ? []
      : [commandSummary(`${displayName(groupId, group)} Stop`, group.stop)]),
  ]),
];

const worktreeRouteLabel = (
  item: { branch: string | null },
  path: string
): string => item.branch ?? pathModule.basename(path);

export const readConfiguredStatus = (
  repoPath: string,
  { state, appGroups: lifecycle, processes }: StatusDependencies
): WorkspaceSnapshot => {
  const selectedRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
  const discovered = resolveWorktrees(selectedRoot);
  if (discovered.length === 0) {
    throw new Error("No Git worktrees were discovered");
  }
  const projectRoot = discovered[0].path;
  const projectConfiguration = resolveProjectConfiguration(projectRoot);
  if (!projectConfiguration) {
    throw new MissingWorktreeConfigError(
      pathModule.join(projectRoot, ".branchbase.json")
    );
  }
  const configPath = projectConfiguration.path;
  const configDocument = projectConfiguration.document;
  const { config } = configDocument;
  const primaryGroupId = primaryAppGroup(config);
  const hasRuns = discovered.some(
    (worktree) =>
      state.runningInstancesForWorktree(projectRoot, worktree.path).length > 0
  );
  const ports = hasRuns
    ? inspectListeningPorts()
    : {
        pidsByPort: new Map<number, Set<number>>(),
        samples: inspectProcessSamples(),
      };
  const worktrees = discovered.map((item, index) => {
    const { id, path } = item;
    const preference = state.worktreeConfigSource(projectRoot, path);
    const resolvedConfiguration = resolveWorktreeConfiguration(
      projectConfiguration,
      path,
      preference
    );
    const {
      document: effectiveDocument,
      error: configurationError,
      path: effectivePath,
      source,
    } = resolvedConfiguration;
    const effectiveConfig = effectiveDocument.config;
    const worktreePrimaryGroupId = primaryAppGroup(effectiveConfig);
    const configuredAppGroups = Object.keys(effectiveConfig.appGroups).map(
      (groupId) =>
        lifecycle.inspect(
          {
            config: effectiveConfig,
            groupId,
            repoPath: projectRoot,
            worktree: {
              id,
              path,
              routeLabel: worktreeRouteLabel(item, path),
            },
          },
          ports
        )
    );
    const configuredInstanceIds = new Set(
      configuredAppGroups.map((group) => group.instance.id)
    );
    const cleanupAppGroups = state
      .runningInstancesForWorktree(projectRoot, path)
      .filter((instance) => !configuredInstanceIds.has(instance.id))
      .map((instance) =>
        lifecycle.inspectDetached(projectRoot, instance, ports)
      );
    const appGroups = [...cleanupAppGroups, ...configuredAppGroups];
    const primary =
      cleanupAppGroups[0] ??
      configuredAppGroups.find(
        (group) => group.id === worktreePrimaryGroupId
      ) ??
      appGroups[0];
    return {
      appGroups,
      appLabel: primary.name,
      apps: primary.apps,
      branch: item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
      configuration: {
        changeBlocked:
          worktreeSetupState(id, path, processes) === "running" ||
          state.hasRunForWorktree(projectRoot, path),
        error: configurationError,
        path: effectivePath,
        preference,
        revision: effectiveDocument.revision,
        source,
        trustCommands: trustCommands(effectiveConfig),
        trustFingerprint: repositoryCommandFingerprint(effectiveConfig),
        trusted: repositoryIsTrusted(
          projectRoot,
          effectiveConfig,
          processes.controlDirectory
        ),
      },
      health: primary.health,
      id,
      isMain: index === 0,
      name: pathModule.basename(path),
      path,
      primaryAppGroup: primary.id,
      processRunning: primary.processRunning,
      setupState: worktreeSetupState(id, path, processes),
    };
  });

  const globalProcesses = processes.listManagedProcesses();
  const samples = ports.samples ?? null;
  const projectOwners = new Set(worktrees.map((worktree) => worktree.id));
  for (const worktree of worktrees) {
    for (const group of worktree.appGroups) {
      const ownerId = appGroupInstanceProcessId(group.instance.id);
      projectOwners.add(ownerId);
      const owned = globalProcesses.filter(
        (process) => process.ownerId === ownerId
      );
      group.resources = owned.length
        ? processTreeUsage(
            samples,
            owned.map((process) => process.pid)
          )
        : null;
    }
  }

  const snapshotResources = processTreeUsage(
    samples,
    globalProcesses
      .filter((process) => projectOwners.has(process.ownerId))
      .map((process) => process.pid)
  );
  const snapshotGlobalRunningCount = new Set(
    worktrees.flatMap((worktree) =>
      worktree.appGroups.flatMap((group) =>
        group.instances
          .filter((instance) => instance.running)
          .map((instance) => instance.id)
      )
    )
  ).size;
  const snapshotRepoName = pathModule.basename(worktrees[0].path);
  const snapshotTrustCommands = trustCommands(config);
  const snapshotTrustFingerprint = repositoryCommandFingerprint(config);
  const snapshotTrustRequired = repositoryRequiresTrust(config);
  const snapshotTrusted = repositoryIsTrusted(
    projectRoot,
    config,
    processes.controlDirectory
  );
  const snapshotUpdatedAt = new Date().toISOString();
  const snapshot: WorkspaceSnapshot = {
    globalProcesses,
    globalRunningCount: snapshotGlobalRunningCount,
    mainWorktreePath: worktrees[0].path,
    projectDefaultConfig: config,
    projectDefaultConfigPath: configPath,
    projectDefaultConfigRevision: configDocument.revision,
    projectDefaultPrimaryAppGroup: primaryGroupId,
    repoName: snapshotRepoName,
    repoPath: projectRoot,
    resources: snapshotResources,
    trustCommands: snapshotTrustCommands,
    trustFingerprint: snapshotTrustFingerprint,
    trustRequired: snapshotTrustRequired,
    trusted: snapshotTrusted,
    updatedAt: snapshotUpdatedAt,
    worktrees,
  };
  return snapshot;
};
