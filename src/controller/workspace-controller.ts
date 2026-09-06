import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { CodexContextStore } from "../codex/branchbase-context";
import {
  CodexHookActivityStore,
  type CodexHookObservation,
} from "../codex/codex-hook-activity";
import {
  type CodexIntegrationAdapter,
  type CodexIntegrationLoadOptions,
  type CodexIntegrationSnapshot,
  projectCodexIntegration,
} from "../codex/codex-integration";
import { CodexTaskDiscoveryAdapter } from "../codex/codex-task-discovery";
import { clearLogs } from "../commands/clear-logs";
import { createAppGroupInstance } from "../commands/create-app-group-instance";
import { createWorktree } from "../commands/create-worktree";
import { deleteWorktree } from "../commands/delete-worktree";
import { initializeRepository as initializeRepositoryCommand } from "../commands/initialize-repository";
import { pickRepository } from "../commands/pick-repository";
import { previewRepositoryConfig } from "../commands/preview-repository-config";
import { restartApps } from "../commands/restart-apps";
import { restartRunningApps } from "../commands/restart-running-apps";
import { retryApps } from "../commands/retry-apps";
import { selectAppGroupInstance } from "../commands/select-app-group-instance";
import { selectWorktreeConfigSource } from "../commands/select-worktree-config-source";
import { setupAllApps } from "../commands/setup-all-apps";
import { startAllApps } from "../commands/start-all-apps";
import { startApps } from "../commands/start-apps";
import { stopAllApps } from "../commands/stop-all-apps";
import { stopApps } from "../commands/stop-apps";
import { trustRepository } from "../commands/trust-repository";
import { updateRepositoryConfig } from "../commands/update-repository-config";
import type { BranchBaseCommand } from "../config/branchbase-command";
import {
  findBranchBaseConfig,
  loadBranchBaseConfig,
  loadBranchBaseConfigDocument,
  resolveSetupCommand,
  updateBranchBaseConfig,
  type WorktreeEnvConfig,
} from "../config/branchbase-config";
import type { BranchBaseConfig } from "../config/branchbase-schema";
import {
  repositoryCommandFingerprint,
  repositoryIsTrusted,
  repositoryRequiresTrust,
  revokeRepositoryTrust,
  trustRepository as saveRepositoryTrust,
} from "../config/repository-trust";
import type { RepositoryTrustApproval } from "../config/repository-trust-approval";
import type { WorktreeConfigSource } from "../config/worktree-config-source";
import {
  type DiscoveredWorktree,
  parseWorktreeList,
} from "../git/discover-worktrees";
import {
  type LocalRoutingEngine,
  PortlessRoutingEngine,
} from "../runtime/local-routing";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { inspectListeningPorts, pathInside } from "../runtime/ports";
import {
  ProcessSupervisor,
  setupProcessId,
} from "../runtime/process-supervisor";
import { AppGroupRuntime, type AppGroupTarget } from "./app-group-runtime";
import {
  type BranchBaseCommandInput,
  type BranchBaseCommandName,
  type BranchBaseCommandResult,
  parseCommandInput,
  parseCommandResult,
} from "./command-contract";
import { initializeRepository as initializeRepositoryConfig } from "./repository-initializer";
import {
  type WorkspaceSnapshot,
  worktreeHasRunningAppGroups,
} from "./workspace-snapshot";
import { commandWorkingDirectory } from "./worktree-command";

type CommandHandler = (
  controller: WorkspaceController,
  input: Record<string, unknown>
) => unknown;

const COMMAND_HANDLERS: Record<BranchBaseCommandName, CommandHandler> = {
  "revoke-trust": (controller, input) => {
    controller.revokeTrust(String(input.repoPath));
    return {
      ok: true,
      command: "revoke-trust",
      message: "Command approvals revoked",
    };
  },
  "clear-logs": clearLogs,
  "create-app-group-instance": createAppGroupInstance,
  "create-worktree": createWorktree,
  "delete-worktree": deleteWorktree,
  "initialize-repository": initializeRepositoryCommand,
  "pick-repository": pickRepository,
  "preview-repository-config": previewRepositoryConfig,
  "restart-apps": restartApps,
  "restart-running-apps": restartRunningApps,
  "retry-apps": retryApps,
  "select-app-group-instance": selectAppGroupInstance,
  "select-worktree-config-source": selectWorktreeConfigSource,
  "setup-all-apps": setupAllApps,
  "start-all-apps": startAllApps,
  "start-apps": startApps,
  "stop-all-apps": stopAllApps,
  "stop-apps": stopApps,
  "trust-repository": trustRepository,
  "update-repository-config": updateRepositoryConfig,
};

export class MissingWorktreeConfigError extends Error {
  readonly code = "missing_worktree_config";
  readonly configPath: string;

  constructor(configPath: string) {
    super(`Missing worktree environment config: ${configPath}`);
    this.configPath = configPath;
    this.name = "MissingWorktreeConfigError";
  }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "Git command failed").trim()
    );
  }
  return result.stdout.trim();
}

function worktreeId(path: string): string {
  return Buffer.from(realpathSync(path)).toString("base64url");
}

interface ResolvedWorktree extends Omit<DiscoveredWorktree, "path"> {
  id: string;
  path: string;
}

function resolveWorktrees(repositoryRoot: string): ResolvedWorktree[] {
  return parseWorktreeList(
    git(repositoryRoot, ["worktree", "list", "--porcelain"])
  )
    .filter((item) => !item.prunable && existsSync(item.path))
    .map((item) => {
      const path = realpathSync(item.path);
      return { ...item, id: worktreeId(path), path };
    });
}

function commandSummary(label: string, command: BranchBaseCommand): string {
  return `${label}: ${command.argv.join(" ")}`;
}

function worktreeSetupState(
  id: string,
  path: string,
  processes: ProcessSupervisor
): "failed" | "idle" | "running" {
  const processId = setupProcessId(id);
  if (processes.managedPid(processId, path) !== null) {
    return "running";
  }
  return processes.managedFailure(processId) ? "failed" : "idle";
}

function primaryAppGroup(config: BranchBaseConfig): string {
  const entries = Object.entries(config.appGroups);
  return (
    entries.find(([, group]) => group.stop === "process")?.[0] ?? entries[0][0]
  );
}

function displayName(id: string, value: { name?: string }): string {
  return value.name ?? id;
}

function trustCommands(config: BranchBaseConfig): string[] {
  return [
    commandSummary("Setup", config.setup),
    ...Object.entries(config.appGroups).flatMap(([groupId, group]) => [
      commandSummary(`${displayName(groupId, group)} Start`, group.start),
      ...(group.stop === "process"
        ? []
        : [commandSummary(`${displayName(groupId, group)} Stop`, group.stop)]),
    ]),
  ];
}

function worktreeRouteLabel(
  item: { branch: string | null },
  path: string
): string {
  return item.branch ?? basename(path);
}

export interface WorkspaceControllerRuntimeOptions {
  codexContext?: CodexContextStore;
  codexHooks?: CodexHookActivityStore;
  developmentStartPreflight?: DevelopmentStartPreflight;
  processes?: ProcessSupervisor;
  routing?: LocalRoutingEngine;
  state?: FileBranchBaseStateStore;
}

export type DevelopmentStartPreflight = (
  worktreePath: string
) => Promise<void> | void;

export interface CodexHookResult {
  accepted: boolean;
  additionalContext?: string;
}

export class WorkspaceController {
  private readonly appGroups: AppGroupRuntime;
  private readonly codexAdapter: CodexIntegrationAdapter;
  private readonly codexActivity: CodexHookActivityStore;
  private readonly codexContext: CodexContextStore;
  private readonly developmentStartPreflight:
    | DevelopmentStartPreflight
    | undefined;
  private readonly codexRefreshes = new Map<string, Promise<void>>();
  private readonly knownCodexTasksByPath = new Map<string, Set<string>>();
  private readonly pendingCodexObservations = new Map<
    string,
    Map<string, { cwd: string; sessionId: string }>
  >();
  private readonly processes: ProcessSupervisor;
  private readonly routing: LocalRoutingEngine;
  private readonly state: FileBranchBaseStateStore;

  constructor(
    codexAdapter: CodexIntegrationAdapter = new CodexTaskDiscoveryAdapter(),
    runtime: WorkspaceControllerRuntimeOptions = {}
  ) {
    this.codexAdapter = codexAdapter;
    this.codexActivity = runtime.codexHooks ?? new CodexHookActivityStore();
    this.codexContext = runtime.codexContext ?? new CodexContextStore();
    this.developmentStartPreflight = runtime.developmentStartPreflight;
    this.processes = runtime.processes ?? new ProcessSupervisor();
    this.routing = runtime.routing ?? new PortlessRoutingEngine();
    this.state = runtime.state ?? new FileBranchBaseStateStore();
    this.appGroups = new AppGroupRuntime(
      this.processes,
      this.routing,
      this.state
    );
  }

  close(): Promise<void> {
    return this.codexAdapter.close();
  }

  async inspectCodex(
    repoPath: string,
    options?: CodexIntegrationLoadOptions
  ): Promise<CodexIntegrationSnapshot> {
    const workspace = this.inspect(repoPath);
    const worktrees = workspace.worktrees.map(({ id, path }) => ({ id, path }));
    const discovered = await this.codexAdapter.loadAssociatedTasks(
      worktrees,
      options
    );
    for (const { path } of worktrees) {
      this.knownCodexTasksByPath.set(path, new Set());
    }
    for (const { task, worktreePath } of discovered.tasks) {
      this.knownCodexTasksByPath.get(worktreePath)?.add(task.id);
    }
    const activitySnapshot = this.codexActivity.applyToSnapshot(
      discovered,
      new Date(),
      (worktreePath) => this.codexEnabledWorktree(worktreePath)
    );
    const adapterSnapshot = this.codexContext.applyToSnapshot(activitySnapshot);
    return projectCodexIntegration(worktrees, adapterSnapshot);
  }

  observeCodexHook(observation: CodexHookObservation): boolean {
    return this.acceptCodexHook(observation, new Date()) !== null;
  }

  handleCodexHook(
    observation: CodexHookObservation,
    observedAt = new Date()
  ): CodexHookResult {
    const accepted = this.acceptCodexHook(observation, observedAt);
    if (!accepted) {
      return { accepted: false };
    }
    if (accepted.cwd !== accepted.root) {
      return { accepted: true };
    }
    try {
      const worktree = this.inspect(accepted.root).worktrees.find(
        ({ path }) => path === accepted.cwd
      );
      const additionalContext = worktree
        ? this.codexContext.share(observation, worktree, observedAt)
        : undefined;
      return additionalContext
        ? { accepted: true, additionalContext }
        : { accepted: true };
    } catch {
      return { accepted: true };
    }
  }

  private acceptCodexHook(
    observation: CodexHookObservation,
    observedAt: Date
  ): { cwd: string; root: string } | null {
    try {
      const cwd = realpathSync(observation.cwd);
      const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
      if (!this.codexEnabledWorktree(root)) {
        return null;
      }
      this.codexActivity.observe({ ...observation, cwd }, observedAt);
      if (!this.knownCodexTasksByPath.get(cwd)?.has(observation.sessionId)) {
        const pending = this.pendingCodexObservations.get(root) ?? new Map();
        pending.set(`${cwd}\0${observation.sessionId}`, {
          cwd,
          sessionId: observation.sessionId,
        });
        this.pendingCodexObservations.set(root, pending);
        this.requestCodexRefresh(root);
      }
      return { cwd, root };
    } catch {
      return null;
    }
  }

  async execute<Name extends BranchBaseCommandName>(
    command: Name,
    input: unknown
  ): Promise<BranchBaseCommandResult<Name>> {
    const handler = COMMAND_HANDLERS[command];
    const parsed = parseCommandInput(command, input);
    const result = await handler(
      this,
      parsed as BranchBaseCommandInput<Name> & Record<string, unknown>
    );
    return parseCommandResult(command, result);
  }

  inspect(repoPath: string): WorkspaceSnapshot {
    const selectedRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
    const discovered = resolveWorktrees(selectedRoot);
    if (discovered.length === 0) {
      throw new Error("No Git worktrees were discovered");
    }
    const projectRoot = discovered[0].path;
    const configPath = findBranchBaseConfig(projectRoot);
    if (!configPath) {
      throw new MissingWorktreeConfigError(
        join(projectRoot, ".branchbase.json")
      );
    }
    const configDocument = loadBranchBaseConfigDocument(configPath);
    const config = configDocument.config;
    const primaryGroupId = primaryAppGroup(config);
    const ports = inspectListeningPorts();
    const worktrees = discovered.map((item, index) => {
      const { id, path } = item;
      const preference = this.state.worktreeConfigSource(projectRoot, path);
      let effectiveDocument = configDocument;
      let effectivePath = configPath;
      let source: WorktreeConfigSource = "project-default";
      let configurationError: string | null = null;
      if (preference === "checkout") {
        const checkoutConfigPath = findBranchBaseConfig(path);
        if (checkoutConfigPath) {
          try {
            effectiveDocument =
              loadBranchBaseConfigDocument(checkoutConfigPath);
            effectivePath = checkoutConfigPath;
            source = "checkout";
          } catch (error) {
            configurationError = `Invalid checkout configuration: ${
              error instanceof Error ? error.message : String(error)
            }`;
          }
        } else {
          configurationError = `Missing checkout configuration: ${join(path, ".branchbase.json")}`;
        }
      }
      const effectiveConfig = effectiveDocument.config;
      const worktreePrimaryGroupId = primaryAppGroup(effectiveConfig);
      const configuredAppGroups = Object.keys(effectiveConfig.appGroups).map(
        (groupId) =>
          this.appGroups.inspect(
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
      const cleanupAppGroups = this.state
        .runningInstancesForWorktree(projectRoot, path)
        .filter((instance) => !configuredInstanceIds.has(instance.id))
        .map((instance) =>
          this.appGroups.inspectDetached(projectRoot, instance, ports)
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
        branch:
          item.branch ?? `detached ${item.head?.slice(0, 7) ?? "unknown"}`,
        configuration: {
          changeBlocked:
            worktreeSetupState(id, path, this.processes) === "running" ||
            this.state.hasRunForWorktree(projectRoot, path),
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
            this.processes.controlDirectory
          ),
        },
        health: primary.health,
        id,
        isMain: index === 0,
        name: basename(path),
        path,
        primaryAppGroup: primary.id,
        processRunning: primary.processRunning,
        setupState: worktreeSetupState(id, path, this.processes),
      };
    });

    const globalProcesses = this.processes.listManagedProcesses();
    return {
      globalProcesses,
      globalRunningCount: new Set(
        worktrees.flatMap((worktree) =>
          worktree.appGroups.flatMap((group) =>
            group.instances
              .filter((instance) => instance.running)
              .map((instance) => instance.id)
          )
        )
      ).size,
      mainWorktreePath: worktrees[0].path,
      projectDefaultConfig: config,
      projectDefaultConfigPath: configPath,
      projectDefaultConfigRevision: configDocument.revision,
      projectDefaultPrimaryAppGroup: primaryGroupId,
      repoName: basename(worktrees[0].path),
      repoPath: projectRoot,
      trustCommands: trustCommands(config),
      trustFingerprint: repositoryCommandFingerprint(config),
      trustRequired: repositoryRequiresTrust(config),
      trusted: repositoryIsTrusted(
        projectRoot,
        config,
        this.processes.controlDirectory
      ),
      updatedAt: new Date().toISOString(),
      worktrees,
    };
  }

  revokeTrust(repoPath: string): void {
    const workspace = this.inspect(repoPath);
    const resources = this.state.repositoryResources(workspace.repoPath);
    const worktreePaths = [
      ...new Set([
        ...resources.worktreePaths,
        ...workspace.worktrees.map((worktree) => worktree.path),
      ]),
    ];
    const hasPendingLifecycle = resources.worktreePaths.some((worktreePath) =>
      this.appGroups.hasPendingLifecycle(worktreePath)
    );
    const setupProcessIds = new Set(
      worktreePaths.map((path) =>
        setupProcessId(Buffer.from(path).toString("base64url"))
      )
    );
    const hasRunningSetup = this.processes
      .listManagedProcesses()
      .some(
        (process) =>
          process.label === "Setup" &&
          setupProcessIds.has(process.ownerId) &&
          worktreePaths.some((path) => pathInside(process.cwd, path))
      );
    if (
      resources.hasRetainedRuns ||
      hasRunningSetup ||
      hasPendingLifecycle ||
      workspace.worktrees.some(
        (worktree) =>
          worktreeHasRunningAppGroups(worktree) ||
          worktree.setupState === "running" ||
          this.appGroups.hasPendingLifecycle(worktree.path)
      )
    ) {
      throw new Error(
        "Stop App groups, finish setup processes, and clear retained runs before revoking approval."
      );
    }
    revokeRepositoryTrust(workspace.repoPath, this.processes.controlDirectory);
  }

  startAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-running" | "started"> {
    if (!this.developmentStartPreflight) {
      return this.startTrustedAppGroup(repoPath, worktreeIdValue, groupId);
    }
    return this.startAppGroupAfterDevelopmentPreflight(
      repoPath,
      worktreeIdValue,
      groupId,
      this.developmentStartPreflight
    );
  }

  retryAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-running" | "retried"> {
    this.assertTrusted(repoPath, worktreeIdValue);
    const target = this.appGroupTarget(repoPath, worktreeIdValue, groupId);
    this.assertConfigTrusted(target.repoPath, target.config);
    return this.appGroups.retry(target);
  }

  stopAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-stopped" | "stopped"> {
    if (this.appGroups.isDetachedGroupId(groupId)) {
      const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
      return this.appGroups.stopDetached(
        workspace.repoPath,
        worktree.path,
        groupId
      );
    }
    const target = this.appGroupTarget(repoPath, worktreeIdValue, groupId);
    if (target.config.appGroups[groupId]?.stop !== "process") {
      this.assertConfigTrusted(target.repoPath, target.config);
    }
    return this.appGroups.stop(target);
  }

  config(repoPath: string): WorktreeEnvConfig {
    return this.inspect(repoPath).projectDefaultConfig;
  }

  updateConfiguration(
    repoPath: string,
    config: BranchBaseConfig,
    revision: string
  ): void {
    const workspace = this.inspect(repoPath);
    const topologyChanged =
      JSON.stringify(workspace.projectDefaultConfig.appGroups) !==
      JSON.stringify(config.appGroups);
    const hasRunningProcesses = workspace.worktrees.some(
      (worktree) =>
        worktree.setupState === "running" ||
        worktreeHasRunningAppGroups(worktree)
    );
    if (topologyChanged && hasRunningProcesses) {
      throw new Error(
        "Stop repository App groups and setup processes before changing their configuration."
      );
    }
    updateBranchBaseConfig(
      workspace.projectDefaultConfigPath,
      config,
      revision
    );
  }

  assertTrusted(repoPath: string, worktreeIdValue?: string): void {
    const workspace = this.inspect(repoPath);
    const trusted = worktreeIdValue
      ? workspace.worktrees.find(({ id }) => id === worktreeIdValue)
          ?.configuration.trusted
      : workspace.trusted;
    if (!trusted) {
      throw new Error("Review and trust this repository's commands first");
    }
  }

  trustRepository(
    repoPath: string,
    approvals?: readonly RepositoryTrustApproval[]
  ): void {
    const workspace = this.inspect(repoPath);
    const reviewed = approvals ?? [
      {
        fingerprint: workspace.trustFingerprint,
      },
    ];
    const configurations = reviewed.map((approval) => {
      const path = approval.worktreeId
        ? (() => {
            const worktree = workspace.worktrees.find(
              (item) => item.id === approval.worktreeId
            );
            if (!worktree) {
              throw new Error("Unknown worktree");
            }
            return worktree.configuration.path;
          })()
        : workspace.projectDefaultConfigPath;
      const config = loadBranchBaseConfig(path);
      if (repositoryCommandFingerprint(config) !== approval.fingerprint) {
        throw new Error(
          "Repository commands changed after they were reviewed; review them again."
        );
      }
      return { config, path };
    });
    for (const { config } of new Map(
      configurations.map((configuration) => [configuration.path, configuration])
    ).values()) {
      saveRepositoryTrust(
        workspace.repoPath,
        config,
        this.processes.controlDirectory
      );
    }
  }

  initializeRepository(repoPath: string) {
    return initializeRepositoryConfig(repoPath);
  }

  worktree(repoPath: string, id: string) {
    const workspace = this.inspect(repoPath);
    const worktree = workspace.worktrees.find((item) => item.id === id);
    if (!worktree) {
      throw new Error("Unknown worktree");
    }
    return { workspace, worktree };
  }

  logs(repoPath: string, id: string, appGroupId?: string): string[] {
    const target = appGroupId
      ? this.appGroupTarget(repoPath, id, appGroupId)
      : null;
    this.worktree(repoPath, id);
    return this.processes.readManagedLog(
      target ? this.appGroups.logId(target) : id
    );
  }

  createAppGroupInstance(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string,
    name: string
  ) {
    return this.appGroups.createInstance(
      this.appGroupTarget(repoPath, worktreeIdValue, groupId),
      name
    );
  }

  selectAppGroupInstance(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string,
    instanceId: string
  ) {
    return this.appGroups.selectInstance(
      this.appGroupTarget(repoPath, worktreeIdValue, groupId),
      instanceId
    );
  }

  selectWorktreeConfigSource(
    repoPath: string,
    worktreeIdValue: string,
    source: WorktreeConfigSource
  ): void {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    if (
      worktree.configuration.changeBlocked ||
      this.appGroups.hasPendingLifecycle(worktree.path)
    ) {
      throw new Error(
        "Stop this worktree's App groups and setup process before changing its configuration source."
      );
    }
    if (source === "checkout") {
      const path = findBranchBaseConfig(worktree.path);
      if (!path) {
        throw new MissingWorktreeConfigError(
          join(worktree.path, ".branchbase.json")
        );
      }
      loadBranchBaseConfigDocument(path);
    }
    this.state.setWorktreeConfigSource(
      {
        repoLabel: workspace.repoName,
        repoPath: workspace.repoPath,
        worktreeLabel: worktree.branch,
        worktreePath: worktree.path,
      },
      source
    );
  }

  startSetup(repoPath: string, worktreeIdValue: string): void {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    const config = loadBranchBaseConfig(worktree.configuration.path);
    this.assertConfigTrusted(workspace.repoPath, config);
    const setup = resolveSetupCommand(config);
    this.processes.appendManagedLog(
      worktree.id,
      `[branchbase] Running setup: ${setup.argv.join(" ")}`
    );
    this.processes.startManagedProcess({
      argv: setup.argv,
      cwd: commandWorkingDirectory(worktree.path, setup.cwd),
      env: setup.env,
      label: "Setup",
      logId: worktree.id,
      ownerId: worktree.id,
      ownerRoot: worktree.path,
      trackExitFailure: true,
      processId: setupProcessId(worktree.id),
    });
  }

  clearLogs(repoPath: string, worktreeIdValue: string, groupId: string): void {
    const target = this.appGroupTarget(repoPath, worktreeIdValue, groupId);
    this.processes.clearManagedLog(this.appGroups.logId(target));
  }

  private appGroupTarget(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): AppGroupTarget {
    const { workspace, worktree } = this.worktree(repoPath, worktreeIdValue);
    const config = loadBranchBaseConfig(worktree.configuration.path);
    if (!config.appGroups[groupId]) {
      throw new Error(`Unknown App group "${groupId}"`);
    }
    return {
      config,
      groupId,
      repoPath: workspace.repoPath,
      worktree: {
        id: worktree.id,
        path: worktree.path,
        routeLabel: worktree.branch,
      },
    };
  }

  private async startAppGroupAfterDevelopmentPreflight(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string,
    preflight: DevelopmentStartPreflight
  ): Promise<"already-running" | "started"> {
    await preflight(this.readOnlyWorktreePath(repoPath, worktreeIdValue));
    return this.startTrustedAppGroup(repoPath, worktreeIdValue, groupId);
  }

  private startTrustedAppGroup(
    repoPath: string,
    worktreeIdValue: string,
    groupId: string
  ): Promise<"already-running" | "started"> {
    this.assertTrusted(repoPath, worktreeIdValue);
    const target = this.appGroupTarget(repoPath, worktreeIdValue, groupId);
    this.assertConfigTrusted(target.repoPath, target.config);
    return this.appGroups.start(target);
  }

  protected assertConfigTrusted(
    repoPath: string,
    config: BranchBaseConfig
  ): void {
    if (
      !repositoryIsTrusted(repoPath, config, this.processes.controlDirectory)
    ) {
      throw new Error("Review and trust this repository's commands first");
    }
  }

  private readOnlyWorktreePath(
    repoPath: string,
    worktreeIdValue: string
  ): string {
    let worktreePaths: string[];
    try {
      const selectedRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
      worktreePaths = resolveWorktrees(selectedRoot).map(({ path }) => path);
    } catch (error) {
      throw new Error(
        `Could not resolve BranchBase worktrees for "${repoPath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
    const worktreePath = worktreePaths.find(
      (path) => worktreeId(path) === worktreeIdValue
    );
    if (!worktreePath) {
      throw new Error("Unknown worktree");
    }
    return worktreePath;
  }

  private codexEnabledWorktree(path: string): boolean {
    try {
      const root = realpathSync(path);
      const configPath = findBranchBaseConfig(root);
      if (!configPath) {
        return false;
      }
      loadBranchBaseConfigDocument(configPath);
      return true;
    } catch {
      return false;
    }
  }

  private requestCodexRefresh(root: string): void {
    if (this.codexRefreshes.has(root)) {
      return;
    }
    const refresh = this.inspectCodex(root, { force: true })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.discardUnmatchedCodexObservations(root);
        if (this.codexRefreshes.get(root) === refresh) {
          this.codexRefreshes.delete(root);
        }
      });
    this.codexRefreshes.set(root, refresh);
  }

  private discardUnmatchedCodexObservations(root: string): void {
    const pending = this.pendingCodexObservations.get(root);
    this.pendingCodexObservations.delete(root);
    for (const observation of pending?.values() ?? []) {
      if (
        !this.knownCodexTasksByPath
          .get(observation.cwd)
          ?.has(observation.sessionId)
      ) {
        this.codexActivity.discard(observation.cwd, observation.sessionId);
        this.codexContext.discard(observation.cwd, observation.sessionId);
      }
    }
  }
}
