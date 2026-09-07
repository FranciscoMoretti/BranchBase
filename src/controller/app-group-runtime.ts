import { basename } from "node:path";

import {
  type ResolvedBranchBaseAppGroups,
  resolveStartCommand,
  resolveStopCommand,
} from "../config/branchbase-config";
import type {
  BranchBaseApp,
  BranchBaseAppGroup,
  BranchBaseConfig,
} from "../config/branchbase-schema";
import {
  repositoryCommandFingerprint,
  repositoryFingerprintIsTrusted,
} from "../config/repository-trust";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../runtime/local-routing";
import type {
  AppGroupInstance,
  AppGroupRun,
  EndpointAssignment,
  FileBranchBaseStateStore,
  InstanceRequest,
  RunEndpoint,
  RunKey,
} from "../runtime/local-state";
import {
  inspectListeningPorts,
  listeningPortPids,
  ownedPortPids,
  portOwnership,
} from "../runtime/ports";
import {
  appGroupInstanceProcessId,
  type ProcessSupervisor,
} from "../runtime/process-supervisor";
import {
  appIsReady,
  appIsReadySync,
  type BackingPortLease,
  reserveBackingPort,
  waitForAppReadiness,
} from "../runtime/readiness";
import { AppGroupLifecycleError } from "./app-group-lifecycle-error";
import type {
  AppEndpointSnapshot,
  AppGroupSnapshot,
  AppHealth,
} from "./workspace-snapshot";
import { commandWorkingDirectory } from "./worktree-command";

export interface AppGroupTarget {
  config: BranchBaseConfig;
  groupId: string;
  repoPath: string;
  worktree: {
    id: string;
    path: string;
    routeLabel: string;
  };
}

interface LifecycleContext {
  group: BranchBaseAppGroup;
  key: RunKey;
  processId: string;
  processPath: string;
  target: AppGroupTarget;
}

interface RunContext extends LifecycleContext {
  run: AppGroupRun;
}

interface StopContext extends LifecycleContext {
  run: AppGroupRun | null;
}

function displayName(id: string, value: { name?: string }): string {
  return value.name ?? id;
}

function groupHealth(apps: AppEndpointSnapshot[]): AppHealth {
  if (apps.length === 0 || apps.every((app) => !app.listening)) {
    return "not-running";
  }
  return apps.every((app) => app.readiness === "ready")
    ? "running"
    : "partially-running";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandEndpointIsClaimed(
  endpoint: RunEndpoint,
  ports: ReturnType<typeof inspectListeningPorts>
): boolean {
  const current = listeningPortPids(ports, endpoint.port);
  return current.length > 0 && endpoint.listenerClaimed === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PORT_STOP_TIMEOUT_MS = 5000;

export class AppGroupRuntime {
  private readonly lifecycleOperations = new Map<string, Promise<void>>();
  private readonly pendingWorktreeOperations = new Map<string, number>();
  private readonly processes: ProcessSupervisor;
  private readonly routing: LocalRoutingEngine;
  private readonly state: FileBranchBaseStateStore;

  constructor(
    processes: ProcessSupervisor,
    routing: LocalRoutingEngine,
    state: FileBranchBaseStateStore
  ) {
    this.processes = processes;
    this.routing = routing;
    this.state = state;
  }

  inspect(
    target: AppGroupTarget,
    ports: ReturnType<typeof inspectListeningPorts>
  ): AppGroupSnapshot {
    const instance = this.state.instance(this.instanceRequest(target));
    return this.inspectInstance(target, instance, ports);
  }

  inspectDetached(
    repoPath: string,
    instance: AppGroupInstance,
    ports: ReturnType<typeof inspectListeningPorts>
  ): AppGroupSnapshot {
    const run = instance.run;
    if (!run) {
      throw new Error("Cleanup target has no persisted run");
    }
    const target = this.detachedTarget(repoPath, instance, run);
    const snapshot = this.inspectInstance(target, instance, ports);
    return {
      ...snapshot,
      cleanupOnly: true,
      id: this.detachedGroupId(instance.id),
      instance: { ...snapshot.instance, mode: "per-worktree" },
      instances: [{ id: instance.id, name: instance.name, running: true }],
      name: `${run.groupId} (cleanup)`,
      stop: run.stop && run.stop !== "process" ? "command" : "process",
    };
  }

  private inspectInstance(
    target: AppGroupTarget,
    instance: AppGroupInstance,
    ports: ReturnType<typeof inspectListeningPorts>
  ): AppGroupSnapshot {
    const group = this.group(target);
    const run = this.state.run(this.runKey(target.repoPath, instance.id));
    const processPath = run?.worktreePath ?? target.worktree.path;
    const processRunning =
      this.processes.managedPid(
        appGroupInstanceProcessId(instance.id),
        processPath
      ) !== null;
    const apps = Object.entries(group.apps).map(([appId, app]) => {
      const assignment = this.endpointAssignment({
        app,
        appId,
        groupId: target.groupId,
        instance,
        repoPath: target.repoPath,
      });
      return this.inspectEndpoint({
        app,
        appId,
        assignment,
        ports,
        run: run?.apps[appId] ?? null,
        stop: group.stop,
        worktreePath: processPath,
      });
    });
    return {
      apps,
      category: group.category ?? "application",
      run: run
        ? { startedAt: run.createdAt, worktreePath: run.worktreePath }
        : null,
      dependencies: this.inspectDependencies(target, group, run),
      pending: this.lifecycleOperations.has(
        this.lifecycleKey(target.repoPath, instance.id)
      ),
      health: groupHealth(apps),
      id: target.groupId,
      instance: {
        id: instance.id,
        mode: instance.mode,
        name: instance.name,
      },
      instances:
        instance.mode === "selectable"
          ? this.state
              .instances(
                target.repoPath,
                target.groupId,
                repositoryCommandFingerprint(target.config)
              )
              .map((option) => ({
                id: option.id,
                name: option.name,
                running: this.instanceIsRunning(option, group.stop, ports),
              }))
          : [
              {
                id: instance.id,
                name: instance.name,
                running: this.instanceIsRunning(instance, group.stop, ports),
              },
            ],
      name: displayName(target.groupId, group),
      processRunning,
      stop: group.stop === "process" ? "process" : "command",
    };
  }

  private inspectDependencies(
    target: AppGroupTarget,
    group: BranchBaseAppGroup,
    run: AppGroupRun | null
  ) {
    const templates = [...Object.values(group.env ?? {}), ...group.start.argv];
    return Object.keys(target.config.appGroups)
      .filter(
        (groupId) =>
          groupId !== target.groupId &&
          templates.some((value) =>
            value.includes(`{appGroups.${groupId}.apps.`)
          )
      )
      .flatMap((groupId) => {
        const instanceId = run?.instanceIdsByGroup[groupId];
        const instance = instanceId
          ? this.state.instanceById(target.repoPath, instanceId)
          : this.state.instance(this.instanceRequest({ ...target, groupId }));
        return instance
          ? [{ groupId, instanceId: instance.id, name: instance.name }]
          : [];
      });
  }

  start(target: AppGroupTarget): Promise<"already-running" | "started"> {
    const effectiveInstances = this.worktreeInstances(target);
    return this.trackWorktreeOperation(
      target.worktree.path,
      this.serializeLifecycle(
        Object.values(effectiveInstances).map((instance) =>
          this.lifecycleKey(target.repoPath, instance.id)
        ),
        () => this.startUnlocked(target, effectiveInstances)
      )
    );
  }

  private async startUnlocked(
    target: AppGroupTarget,
    effectiveInstances: Record<string, AppGroupInstance>
  ): Promise<"already-running" | "started"> {
    const group = this.group(target);
    await this.prepareRouting();
    await this.materializeEffectiveInstances(target, effectiveInstances);
    const instance = effectiveInstances[target.groupId];
    if (!instance) {
      throw new Error(`Unknown App group "${target.groupId}"`);
    }
    const key = this.runKey(target.repoPath, instance.id);
    let run = this.state.run(key);
    const allocatedNow = run === null;
    if (!run) {
      run = this.createRun({
        config: target.config,
        effectiveInstances,
        group,
        groupId: target.groupId,
        instance,
        repoPath: target.repoPath,
        worktreePath: target.worktree.path,
      });
      this.state.saveRun(key, run);
    }

    const context = this.runContext(target, instance, run);
    this.assertRunPortsAvailable(context, allocatedNow);
    const readiness = await this.readinessForRun(context);
    if (readiness.every(Boolean) && this.allRoutesAreActive(context.run)) {
      return "already-running";
    }

    this.launchRunProcess(context, readiness);
    await this.waitForAndPublishRun(context);
    return "started";
  }

  retry(target: AppGroupTarget): Promise<"already-running" | "retried"> {
    const instance = this.state.instance(this.instanceRequest(target));
    return this.trackWorktreeOperation(
      target.worktree.path,
      this.serializeLifecycle(
        [this.lifecycleKey(target.repoPath, instance.id)],
        () => this.retryUnlocked(target, instance)
      )
    );
  }

  private async retryUnlocked(
    target: AppGroupTarget,
    instance: AppGroupInstance
  ): Promise<"already-running" | "retried"> {
    await this.prepareRouting();
    const key = this.runKey(target.repoPath, instance.id);
    const run = this.state.run(key);
    if (!run) {
      throw new AppGroupLifecycleError(
        "not-started",
        `${displayName(target.groupId, this.group(target))} has not been started`
      );
    }
    const context = this.runContext(target, instance, run);
    this.assertRunPortsAvailable(context, false);
    const readiness = await this.readinessForRun(context);
    if (readiness.every(Boolean) && this.allRoutesAreActive(context.run)) {
      return "already-running";
    }
    await this.waitForAndPublishRun(context);
    return "retried";
  }

  stop(target: AppGroupTarget): Promise<"already-stopped" | "stopped"> {
    const instance = this.state.instance(this.instanceRequest(target));
    return this.trackWorktreeOperation(
      target.worktree.path,
      this.serializeLifecycle(
        [this.lifecycleKey(target.repoPath, instance.id)],
        () => this.stopUnlocked(target, instance)
      )
    );
  }

  stopDetached(
    repoPath: string,
    worktreePath: string,
    groupId: string
  ): Promise<"already-stopped" | "stopped"> {
    const instanceId = this.detachedInstanceId(groupId);
    const instance = instanceId
      ? this.state.instanceById(repoPath, instanceId)
      : null;
    if (!(instance?.run && instance.run.worktreePath === worktreePath)) {
      throw new Error("Unknown cleanup App group");
    }
    const stopCommandTrusted = repositoryFingerprintIsTrusted(
      repoPath,
      instance.configFingerprint,
      this.processes.controlDirectory
    );
    return this.trackWorktreeOperation(
      worktreePath,
      this.serializeLifecycle([this.lifecycleKey(repoPath, instance.id)], () =>
        this.stopDetachedUnlocked(repoPath, instance, stopCommandTrusted)
      )
    );
  }

  hasPendingLifecycle(worktreePath: string): boolean {
    return (this.pendingWorktreeOperations.get(worktreePath) ?? 0) > 0;
  }

  isDetachedGroupId(groupId: string): boolean {
    return this.detachedInstanceId(groupId) !== null;
  }

  private async stopUnlocked(
    target: AppGroupTarget,
    instance: AppGroupInstance
  ): Promise<"already-stopped" | "stopped"> {
    const key = this.runKey(target.repoPath, instance.id);
    const run = this.state.run(key);
    const context = this.stopContext(target, instance, run);
    if (
      !run &&
      this.processes.managedPid(context.processId, context.processPath) === null
    ) {
      return "already-stopped";
    }

    const failures = await this.deactivateRunRoutes(context);
    failures.push(...(await this.executeConfiguredStop(context)));
    await this.stopRunProcesses(context);

    if (context.run && !(await this.waitForPortsStopped(context.run))) {
      failures.push(
        "App listeners did not stop; Backing endpoints remain quarantined"
      );
    }
    if (failures.length === 0) {
      this.state.removeRun(context.key);
    }
    if (failures.length > 0) {
      throw new AppGroupLifecycleError("stop-failed", failures.join("; "));
    }
    return "stopped";
  }

  private async stopDetachedUnlocked(
    repoPath: string,
    instance: AppGroupInstance,
    stopCommandTrusted: boolean
  ): Promise<"already-stopped" | "stopped"> {
    const run = instance.run;
    if (!run) {
      return "already-stopped";
    }
    const target = this.detachedTarget(repoPath, instance, run);
    const context = this.stopContext(target, instance, run);
    const failures = await this.deactivateRunRoutes(context);
    if (run.stop && run.stop !== "process" && stopCommandTrusted) {
      try {
        await this.processes.runFiniteCommand({
          argv: run.stop.argv,
          cwd: commandWorkingDirectory(run.worktreePath, run.stop.cwd),
          env: run.stop.env,
          label: `Stop ${run.groupId}`,
          logId: context.processId,
        });
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }
    await this.stopRunProcesses(context);
    if (!(await this.waitForPortsStopped(run))) {
      failures.push(
        "App listeners did not stop; Backing endpoints remain quarantined"
      );
    }
    if (failures.length === 0) {
      this.state.removeRun(context.key);
      return "stopped";
    }
    throw new AppGroupLifecycleError("stop-failed", failures.join("; "));
  }

  private async deactivateRunRoutes(context: StopContext): Promise<string[]> {
    const failures: string[] = [];
    for (const endpoint of Object.values(context.run?.apps ?? {})) {
      if (endpoint.protocol !== "http" || !endpoint.hostname) {
        continue;
      }
      try {
        const route = this.endpointRoute(endpoint);
        const routeState = this.routing.observe(route);
        if (routeState === "conflict") {
          failures.push(
            `${route.hostname} points to a different Backing endpoint`
          );
        } else if (routeState !== "inactive") {
          await this.routing.deactivate(route);
        }
      } catch (error) {
        failures.push(errorMessage(error));
      }
    }
    return failures;
  }

  private async executeConfiguredStop(context: StopContext): Promise<string[]> {
    if (context.group.stop === "process") {
      return [];
    }
    try {
      const command = resolveStopCommand(
        context.target.config,
        context.target.groupId,
        this.resolveTemplateAppGroups(
          context.target.config,
          context.target.repoPath,
          context.processPath,
          context.run?.instanceIdsByGroup
        )
      );
      if (!command) {
        throw new Error(
          `${displayName(context.target.groupId, context.group)} has no Stop command`
        );
      }
      await this.processes.runFiniteCommand({
        argv: command.argv,
        cwd: commandWorkingDirectory(context.processPath, command.cwd),
        env: command.env,
        label: `Stop ${displayName(context.target.groupId, context.group)}`,
        logId: context.processId,
      });
      return [];
    } catch (error) {
      return [errorMessage(error)];
    }
  }

  private async stopRunProcesses(context: StopContext): Promise<void> {
    await this.processes.stopManagedProcess(
      context.processId,
      context.processPath
    );
    if (context.group.stop !== "process" || !context.run) {
      return;
    }
    const killed = new Set<number>();
    for (const pid of ownedPortPids(
      inspectListeningPorts(),
      Object.values(context.run.apps).map((app) => app.port),
      context.processPath
    )) {
      if (await this.processes.stopOwnedProcess(pid, context.processId)) {
        killed.add(pid);
      }
    }
    if (killed.size > 0) {
      this.processes.appendManagedLog(
        context.processId,
        `[branchbase] Stopped ${killed.size} owned listener${killed.size === 1 ? "" : "s"}`
      );
    }
  }

  createInstance(target: AppGroupTarget, name: string): AppGroupInstance {
    return this.state.createSelectableInstance(
      this.instanceRequest(target),
      name
    );
  }

  selectInstance(target: AppGroupTarget, instanceId: string): AppGroupInstance {
    return this.state.selectInstance(this.instanceRequest(target), instanceId);
  }

  logId(target: AppGroupTarget): string {
    const instance = this.state.instance(this.instanceRequest(target));
    return appGroupInstanceProcessId(instance.id);
  }

  private group(target: AppGroupTarget): BranchBaseAppGroup {
    const group = target.config.appGroups[target.groupId];
    if (!group) {
      throw new Error(`Unknown App group "${target.groupId}"`);
    }
    return group;
  }

  private instanceRequest(target: AppGroupTarget): InstanceRequest {
    const group = this.group(target);
    return {
      configFingerprint: repositoryCommandFingerprint(target.config),
      groupId: target.groupId,
      mode: group.instances.mode,
      repoLabel: basename(target.repoPath),
      repoPath: target.repoPath,
      worktreeLabel: target.worktree.routeLabel,
      worktreePath: target.worktree.path,
    };
  }

  private async serializeLifecycle<T>(
    keys: readonly string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const operationKeys = [...new Set(keys)].toSorted();
    const predecessor = Promise.all(
      operationKeys.map((key) =>
        (this.lifecycleOperations.get(key) ?? Promise.resolve()).catch(
          () => undefined
        )
      )
    ).then(() => undefined);
    let release: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => completion);
    for (const key of operationKeys) {
      this.lifecycleOperations.set(key, tail);
    }
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      for (const key of operationKeys) {
        if (this.lifecycleOperations.get(key) === tail) {
          this.lifecycleOperations.delete(key);
        }
      }
    }
  }

  private lifecycleKey(repoPath: string, instanceId: string): string {
    return [repoPath, instanceId].join("\0");
  }

  private detachedGroupId(instanceId: string): string {
    return `cleanup:${instanceId}`;
  }

  private detachedInstanceId(groupId: string): string | null {
    return groupId.startsWith("cleanup:")
      ? groupId.slice("cleanup:".length)
      : null;
  }

  private detachedTarget(
    repoPath: string,
    instance: AppGroupInstance,
    run: AppGroupRun
  ): AppGroupTarget {
    const apps = Object.fromEntries(
      Object.entries(run.apps).map(([appId, app]) => [
        appId,
        { protocol: app.protocol, readiness: "tcp" as const },
      ])
    );
    return {
      config: {
        appGroups: {
          [run.groupId]: {
            apps,
            instances: { mode: instance.mode },
            start: { argv: ["true"] },
            stop: "process",
          },
        },
        setup: { argv: ["true"] },
        version: 1,
      },
      groupId: run.groupId,
      repoPath,
      worktree: {
        id: run.worktreePath,
        path: run.worktreePath,
        routeLabel: instance.routeLabel,
      },
    };
  }

  private trackWorktreeOperation<T>(
    worktreePath: string,
    operation: Promise<T>
  ): Promise<T> {
    this.pendingWorktreeOperations.set(
      worktreePath,
      (this.pendingWorktreeOperations.get(worktreePath) ?? 0) + 1
    );
    return operation.finally(() => {
      const remaining =
        (this.pendingWorktreeOperations.get(worktreePath) ?? 1) - 1;
      if (remaining === 0) {
        this.pendingWorktreeOperations.delete(worktreePath);
      } else {
        this.pendingWorktreeOperations.set(worktreePath, remaining);
      }
    });
  }

  private worktreeInstances(
    target: AppGroupTarget
  ): Record<string, AppGroupInstance> {
    return Object.fromEntries(
      Object.entries(target.config.appGroups).map(([groupId, group]) => [
        groupId,
        this.state.instance({
          configFingerprint: repositoryCommandFingerprint(target.config),
          groupId,
          mode: group.instances.mode,
          repoLabel: basename(target.repoPath),
          repoPath: target.repoPath,
          worktreeLabel: target.worktree.routeLabel,
          worktreePath: target.worktree.path,
        }),
      ])
    );
  }

  private runKey(repoPath: string, instanceId: string): RunKey {
    return { instanceId, repoPath };
  }

  private lifecycleContext(
    target: AppGroupTarget,
    instance: AppGroupInstance,
    processPath: string
  ): LifecycleContext {
    return {
      group: this.group(target),
      key: this.runKey(target.repoPath, instance.id),
      processId: appGroupInstanceProcessId(instance.id),
      processPath,
      target,
    };
  }

  private runContext(
    target: AppGroupTarget,
    instance: AppGroupInstance,
    run: AppGroupRun
  ): RunContext {
    return {
      ...this.lifecycleContext(target, instance, run.worktreePath),
      run,
    };
  }

  private stopContext(
    target: AppGroupTarget,
    instance: AppGroupInstance,
    run: AppGroupRun | null
  ): StopContext {
    return {
      ...this.lifecycleContext(
        target,
        instance,
        run?.worktreePath ?? target.worktree.path
      ),
      run,
    };
  }

  private async prepareRouting(): Promise<void> {
    try {
      await this.routing.prepare?.();
    } catch (error) {
      throw new AppGroupLifecycleError(
        "routing-unavailable",
        errorMessage(error)
      );
    }
  }

  private runEndpointFor(run: AppGroupRun, appId: string): RunEndpoint {
    const endpoint = run.apps[appId];
    if (!endpoint) {
      throw new AppGroupLifecycleError(
        "invalid-run-state",
        `Persisted run is missing App "${appId}"`
      );
    }
    return endpoint;
  }

  private readinessForRun(context: RunContext): Promise<boolean[]> {
    return Promise.all(
      Object.entries(context.group.apps).map(([appId, app]) =>
        appIsReady(app, this.runEndpointFor(context.run, appId))
      )
    );
  }

  private async waitForAndPublishRun(context: RunContext): Promise<void> {
    const readyAppIds = await this.waitForRunReadiness(context);
    this.assertReadyEndpointsOwned(context.group, context.run, readyAppIds);
    await this.publishReadyRun(context, readyAppIds);
  }

  private instanceIsRunning(
    instance: AppGroupInstance,
    stop: BranchBaseAppGroup["stop"],
    ports: ReturnType<typeof inspectListeningPorts>
  ): boolean {
    const run = instance.run;
    if (!run) {
      return false;
    }
    if (
      this.processes.managedPid(
        appGroupInstanceProcessId(instance.id),
        run.worktreePath
      ) !== null
    ) {
      return true;
    }
    return Object.values(run.apps).some((endpoint) => {
      const ownership = portOwnership(ports, endpoint.port, run.worktreePath);
      return stop === "process"
        ? ownership === "owned"
        : commandEndpointIsClaimed(endpoint, ports);
    });
  }

  private createRun(input: {
    config: BranchBaseConfig;
    effectiveInstances: Record<string, AppGroupInstance>;
    group: BranchBaseAppGroup;
    groupId: string;
    instance: AppGroupInstance;
    repoPath: string;
    worktreePath: string;
  }): AppGroupRun {
    const apps = Object.fromEntries(
      Object.entries(input.group.apps).map(([appId, app]) => {
        const assignment = this.endpointAssignment({
          app,
          appId,
          groupId: input.groupId,
          instance: input.instance,
          repoPath: input.repoPath,
        });
        return [appId, this.runEndpoint(app, assignment)];
      })
    );
    const instanceIdsByGroup = Object.fromEntries(
      Object.entries(input.effectiveInstances).map(([groupId, instance]) => [
        groupId,
        instance.id,
      ])
    );
    const stop =
      input.group.stop === "process"
        ? "process"
        : resolveStopCommand(
            input.config,
            input.groupId,
            this.resolveTemplateAppGroups(
              input.config,
              input.repoPath,
              input.worktreePath,
              instanceIdsByGroup
            )
          );
    return {
      apps,
      createdAt: new Date().toISOString(),
      groupId: input.groupId,
      instanceId: input.instance.id,
      instanceIdsByGroup,
      stop: stop ?? "process",
      worktreePath: input.worktreePath,
    };
  }

  private assertRunPortsAvailable(
    context: RunContext,
    allocatedNow: boolean
  ): void {
    const ports = inspectListeningPorts();
    const occupied = Object.values(context.run.apps).find((endpoint) => {
      const pids = listeningPortPids(ports, endpoint.port);
      if (pids.length === 0) {
        return false;
      }
      if (allocatedNow) {
        return true;
      }
      if (context.group.stop === "process") {
        return (
          portOwnership(ports, endpoint.port, context.run.worktreePath) !==
          "owned"
        );
      }
      return endpoint.listenerClaimed !== true;
    });
    if (!occupied) {
      return;
    }
    if (allocatedNow) {
      this.state.removeRun(context.key);
    }
    throw new AppGroupLifecycleError(
      "port-occupied",
      `Backing endpoint ${occupied.port} is occupied by an unrelated process`
    );
  }

  private allRoutesAreActive(run: AppGroupRun): boolean {
    return Object.values(run.apps).every(
      (endpoint) =>
        endpoint.protocol !== "http" ||
        (endpoint.hostname &&
          this.routing.observe(this.endpointRoute(endpoint)) === "active")
    );
  }

  private launchRunProcess(
    context: RunContext,
    readiness: readonly boolean[]
  ): void {
    if (
      this.processes.managedPid(context.processId, context.processPath) !==
        null ||
      readiness.some(Boolean)
    ) {
      return;
    }
    try {
      const command = resolveStartCommand(
        context.target.config,
        context.target.groupId,
        this.resolveTemplateAppGroups(
          context.target.config,
          context.target.repoPath,
          context.processPath,
          context.run.instanceIdsByGroup
        )
      );
      this.processes.startManagedProcess({
        argv: command.argv,
        cwd: commandWorkingDirectory(context.processPath, command.cwd),
        env: command.env,
        label: displayName(context.target.groupId, context.group),
        logId: context.processId,
        ownerId: context.processId,
        ownerRoot: context.processPath,
        trackExitFailure: true,
        processId: context.processId,
      });
    } catch (error) {
      throw new AppGroupLifecycleError("start-failed", errorMessage(error));
    }
  }

  private async waitForRunReadiness(context: RunContext): Promise<Set<string>> {
    const settled = await Promise.allSettled(
      Object.entries(context.group.apps).map(async ([appId, app]) => {
        await waitForAppReadiness(app, this.runEndpointFor(context.run, appId));
        return appId;
      })
    );
    const readyAppIds = new Set(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
    );
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [errorMessage(result.reason)] : []
    );
    if (readyAppIds.size === 0) {
      this.observeRunListeners(context.run);
      this.state.saveRun(context.key, context.run);
      throw new AppGroupLifecycleError("readiness-failed", failures.join("; "));
    }
    for (const failure of failures) {
      this.processes.appendManagedLog(
        context.processId,
        `[branchbase] ${failure}`
      );
    }
    return readyAppIds;
  }

  private assertReadyEndpointsOwned(
    group: BranchBaseAppGroup,
    run: AppGroupRun,
    readyAppIds: ReadonlySet<string>
  ): void {
    if (group.stop !== "process") {
      return;
    }
    const ports = inspectListeningPorts();
    const unowned = Object.values(run.apps).find(
      (endpoint) =>
        readyAppIds.has(endpoint.appId) &&
        portOwnership(ports, endpoint.port, run.worktreePath) !== "owned"
    );
    if (unowned) {
      throw new AppGroupLifecycleError(
        "endpoint-ownership-conflict",
        `Backing endpoint ${unowned.port} became ready outside this worktree; no Friendly URLs were published`
      );
    }
  }

  private async publishReadyRun(
    context: RunContext,
    readyAppIds: ReadonlySet<string>
  ): Promise<void> {
    this.observeRunListeners(context.run);
    try {
      await this.activateRoutes(context.run, readyAppIds);
    } catch (error) {
      this.state.saveRun(context.key, context.run);
      throw error;
    }
    this.state.saveRun(context.key, context.run);
  }

  private observeRunListeners(run: AppGroupRun): void {
    const ports = inspectListeningPorts();
    for (const endpoint of Object.values(run.apps)) {
      const observedPids = listeningPortPids(ports, endpoint.port);
      if (observedPids.length > 0) {
        endpoint.listenerClaimed = true;
      }
    }
  }

  private endpointAssignment(input: {
    app: BranchBaseApp;
    appId: string;
    groupId: string;
    instance: AppGroupInstance;
    repoPath: string;
  }): EndpointAssignment {
    return this.state.endpoint({
      appId: input.appId,
      appLabel: displayName(input.appId, input.app),
      groupId: input.groupId,
      instanceId: input.instance.id,
      repoPath: input.repoPath,
    });
  }

  private inspectEndpoint(input: {
    app: BranchBaseApp;
    appId: string;
    assignment: EndpointAssignment;
    ports: ReturnType<typeof inspectListeningPorts>;
    run: RunEndpoint | null;
    stop: BranchBaseAppGroup["stop"];
    worktreePath: string;
  }): AppEndpointSnapshot {
    if (!input.run) {
      return {
        directUrl: null,
        id: input.appId,
        label: displayName(input.appId, input.app),
        listening: false,
        open: false,
        ownership: "none",
        port: input.assignment.port,
        protocol: input.app.protocol,
        readiness: "waiting",
        routeState: "inactive",
        url: null,
      };
    }
    const inspectedOwnership = portOwnership(
      input.ports,
      input.run.port,
      input.worktreePath
    );
    const commandEndpointVerified = commandEndpointIsClaimed(
      input.run,
      input.ports
    );
    const listening =
      input.stop === "process"
        ? inspectedOwnership === "owned"
        : commandEndpointVerified;
    let ownership = inspectedOwnership;
    if (input.stop !== "process") {
      if (commandEndpointVerified) {
        ownership = "owned";
      } else if (inspectedOwnership !== "none") {
        ownership = "foreign";
      }
    }
    const ready = appIsReadySync(input.app, input.run, listening);
    const observedRouteState =
      input.run.protocol === "http" && input.run.hostname
        ? this.routing.observe({
            hostname: input.run.hostname,
            port: input.run.port,
          })
        : "inactive";
    const routeState =
      observedRouteState === "inactive" &&
      ready &&
      input.run.protocol === "http"
        ? "unavailable"
        : observedRouteState;
    return {
      directUrl: input.run.directUrl ?? null,
      id: input.appId,
      label: displayName(input.appId, input.app),
      listening,
      open: ready && routeState === "active",
      ownership,
      port: input.run.port,
      protocol: input.app.protocol,
      readiness: ready ? "ready" : "unready",
      routeState,
      url: ready && routeState === "active" ? (input.run.url ?? null) : null,
    };
  }

  private resolveTemplateAppGroups(
    config: BranchBaseConfig,
    repoPath: string,
    worktreePath: string,
    instanceIdsByGroup?: Record<string, string>
  ): ResolvedBranchBaseAppGroups {
    const configFingerprint = repositoryCommandFingerprint(config);
    return Object.fromEntries(
      Object.entries(config.appGroups).map(([groupId, group]) => [
        groupId,
        {
          apps: Object.fromEntries(
            Object.entries(group.apps).map(([appId, app]) => {
              const selectedInstanceId = instanceIdsByGroup?.[groupId];
              const instance = selectedInstanceId
                ? this.state.instanceById(repoPath, selectedInstanceId)
                : this.state.instance({
                    configFingerprint,
                    groupId,
                    mode: group.instances.mode,
                    repoLabel: basename(repoPath),
                    repoPath,
                    worktreeLabel: basename(worktreePath),
                    worktreePath,
                  });
              if (!(instance && instance.groupId === groupId)) {
                throw new Error(`Unknown App-group instance for "${groupId}"`);
              }
              const assignment = this.endpointAssignment({
                app,
                appId,
                groupId,
                instance,
                repoPath,
              });
              if (assignment.port !== null) {
                return [appId, this.runEndpoint(app, assignment)];
              }
              return [
                appId,
                app.protocol === "http"
                  ? { url: this.routing.url(assignment.hostname) }
                  : {},
              ];
            })
          ),
          id: groupId,
        },
      ])
    );
  }

  private async materializeEffectiveInstances(
    target: AppGroupTarget,
    instances: Readonly<Record<string, AppGroupInstance>>
  ): Promise<void> {
    const leased = this.state.leasedPorts();
    const reservations: BackingPortLease[] = [];
    try {
      for (const [groupId, group] of Object.entries(target.config.appGroups)) {
        const instance = instances[groupId];
        if (!instance) {
          throw new Error(`Unknown App group "${groupId}"`);
        }
        const key = this.runKey(target.repoPath, instance.id);
        for (const [appId, app] of Object.entries(group.apps)) {
          const assignment = this.endpointAssignment({
            app,
            appId,
            groupId,
            instance,
            repoPath: target.repoPath,
          });
          if (assignment.port !== null) {
            continue;
          }
          const reservation = await reserveBackingPort(leased);
          reservations.push(reservation);
          leased.add(reservation.port);
          this.state.assignEndpointPort(key, appId, reservation.port);
        }
      }
    } finally {
      await Promise.all(
        reservations.map((reservation) => reservation.release())
      );
    }
  }

  private runEndpoint(
    app: BranchBaseApp,
    assignment: EndpointAssignment
  ): RunEndpoint {
    if (assignment.port === null) {
      throw new Error(`${assignment.appId} has no assigned port`);
    }
    return {
      appId: assignment.appId,
      ...(app.protocol === "http"
        ? {
            directUrl: `http://127.0.0.1:${assignment.port}`,
            hostname: assignment.hostname,
            url: this.routing.url(assignment.hostname),
          }
        : {}),
      host: "127.0.0.1",
      port: assignment.port,
      protocol: app.protocol,
    };
  }

  private async waitForPortsStopped(run: AppGroupRun): Promise<boolean> {
    const deadline = Date.now() + PORT_STOP_TIMEOUT_MS;
    const ports = new Set(Object.values(run.apps).map((app) => app.port));
    while (Date.now() < deadline) {
      const snapshot = inspectListeningPorts();
      if (
        [...ports].every(
          (port) => portOwnership(snapshot, port, "/") === "none"
        )
      ) {
        return true;
      }
      await delay(100);
    }
    return false;
  }

  private async activateRoutes(
    run: AppGroupRun,
    readyAppIds: ReadonlySet<string>
  ): Promise<void> {
    const routes = Object.values(run.apps).flatMap((endpoint) =>
      readyAppIds.has(endpoint.appId) &&
      endpoint.protocol === "http" &&
      endpoint.hostname
        ? [this.endpointRoute(endpoint)]
        : []
    );
    const newlyActivated: LocalRoute[] = [];
    try {
      const initialStates = new Map<LocalRoute, LocalRouteState>();
      for (const route of routes) {
        const state = this.routing.observe(route);
        initialStates.set(route, state);
        if (state === "conflict") {
          throw new AppGroupLifecycleError(
            "route-conflict",
            `${route.hostname} is already routed elsewhere`
          );
        }
      }
      for (const route of routes) {
        if (initialStates.get(route) === "inactive") {
          newlyActivated.push(route);
        }
        await this.routing.activate(route);
      }
    } catch (error) {
      const failures = [
        errorMessage(error),
        ...(await this.rollbackRoutes(newlyActivated)),
      ];
      throw new AppGroupLifecycleError(
        error instanceof AppGroupLifecycleError
          ? error.code
          : "route-publication-failed",
        failures.join("; ")
      );
    }
  }

  private async rollbackRoutes(
    routes: readonly LocalRoute[]
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const route of routes.toReversed()) {
      try {
        const routeState = this.routing.observe(route);
        if (routeState !== "active" && routeState !== "unavailable") {
          continue;
        }
        await this.routing.deactivate(route);
      } catch (error) {
        failures.push(`Route rollback failed: ${errorMessage(error)}`);
      }
    }
    return failures;
  }
  private endpointRoute(endpoint: RunEndpoint): LocalRoute {
    if (!endpoint.hostname) {
      throw new Error(`${endpoint.appId} does not have a Friendly hostname`);
    }
    return { hostname: endpoint.hostname, port: endpoint.port };
  }
}
