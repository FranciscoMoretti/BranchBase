import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

import { z } from "zod";

import { WorktreeConfigSourceSchema } from "../config/worktree-config-source";
import type { WorktreeConfigSource } from "../config/worktree-config-source";

const NonEmptyStringSchema = z.string().min(1);
const PortSchema = z.number().int().min(1).max(65_535);
const AppGroupInstanceModeSchema = z.enum(["per-worktree", "selectable"]);

const EndpointAssignmentSchema = z.strictObject({
  appId: NonEmptyStringSchema,
  groupId: NonEmptyStringSchema,
  hostname: NonEmptyStringSchema,
  id: NonEmptyStringSchema,
  port: PortSchema.nullable(),
  routeLabel: NonEmptyStringSchema,
});

const RunEndpointSchema = z.strictObject({
  appId: NonEmptyStringSchema,
  directUrl: NonEmptyStringSchema.optional(),
  host: NonEmptyStringSchema,
  hostname: NonEmptyStringSchema.optional(),
  listenerClaimed: z.boolean().optional(),
  port: PortSchema,
  protocol: z.enum(["http", "tcp"]),
  url: NonEmptyStringSchema.optional(),
});

const ResolvedRunCommandSchema = z.strictObject({
  argv: z.array(NonEmptyStringSchema).min(1),
  cwd: NonEmptyStringSchema.optional(),
  env: z.record(z.string(), z.string()),
});

const AppGroupRunSchema = z.strictObject({
  apps: z.record(z.string(), RunEndpointSchema),
  createdAt: NonEmptyStringSchema,
  groupId: NonEmptyStringSchema,
  instanceId: NonEmptyStringSchema,
  instanceIdsByGroup: z.record(z.string(), NonEmptyStringSchema),
  stop: z.union([z.literal("process"), ResolvedRunCommandSchema]).optional(),
  worktreePath: NonEmptyStringSchema,
});

const AppGroupInstanceSchema = z.strictObject({
  configFingerprint: z.string().default(""),
  endpoints: z.record(z.string(), EndpointAssignmentSchema),
  groupId: NonEmptyStringSchema,
  id: NonEmptyStringSchema,
  isDefault: z.boolean(),
  mode: AppGroupInstanceModeSchema,
  name: NonEmptyStringSchema,
  routeLabel: NonEmptyStringSchema,
  run: AppGroupRunSchema.nullable(),
  worktreePath: NonEmptyStringSchema.nullable(),
});

const WorktreeRecordSchema = z.strictObject({
  configSource: WorktreeConfigSourceSchema.default("project-default"),
  id: NonEmptyStringSchema,
  instanceSelections: z.record(z.string(), NonEmptyStringSchema),
  path: NonEmptyStringSchema,
  routeLabel: NonEmptyStringSchema,
});

const RepositoryRecordSchema = z.strictObject({
  id: NonEmptyStringSchema,
  instances: z.record(z.string(), AppGroupInstanceSchema),
  path: NonEmptyStringSchema,
  routeLabel: NonEmptyStringSchema,
  worktrees: z.record(z.string(), WorktreeRecordSchema),
});

const BranchBaseLocalStateSchema = z.strictObject({
  repositories: z.record(z.string(), RepositoryRecordSchema),
  version: z.literal(2),
});

export type AppGroupInstanceMode = z.infer<typeof AppGroupInstanceModeSchema>;
export type EndpointAssignment = z.infer<typeof EndpointAssignmentSchema>;
export type RunEndpoint = z.infer<typeof RunEndpointSchema>;
export type AppGroupRun = z.infer<typeof AppGroupRunSchema>;
export type AppGroupInstance = z.infer<typeof AppGroupInstanceSchema>;
type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;
type RepositoryRecord = z.infer<typeof RepositoryRecordSchema>;
export type BranchBaseLocalState = z.infer<typeof BranchBaseLocalStateSchema>;

export const parseCurrentBranchBaseLocalState = (
  value: unknown
): BranchBaseLocalState => BranchBaseLocalStateSchema.parse(value);

export interface InstanceRequest {
  configFingerprint: string;
  groupId: string;
  mode: AppGroupInstanceMode;
  repoLabel: string;
  repoPath: string;
  worktreeLabel: string;
  worktreePath: string;
}

export interface EndpointRequest {
  appId: string;
  appLabel: string;
  groupId: string;
  instanceId: string;
  repoPath: string;
}

export interface RunKey {
  instanceId: string;
  repoPath: string;
}

const LegacyEndpointAssignmentSchema = EndpointAssignmentSchema.omit({
  port: true,
});
const LegacyRunSchema = AppGroupRunSchema.omit({
  instanceId: true,
  instanceIdsByGroup: true,
  worktreePath: true,
});
const LegacyWorktreeRecordSchema = z.strictObject({
  endpoints: z.record(z.string(), LegacyEndpointAssignmentSchema),
  id: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  routeLabel: NonEmptyStringSchema,
  runs: z.record(z.string(), LegacyRunSchema),
});
const LegacyRepositoryRecordSchema = z.strictObject({
  id: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  routeLabel: NonEmptyStringSchema,
  worktrees: z.record(z.string(), LegacyWorktreeRecordSchema),
});
const LegacyBranchBaseLocalStateSchema = z.strictObject({
  repositories: z.record(z.string(), LegacyRepositoryRecordSchema),
  version: z.literal(1),
});
type LegacyBranchBaseLocalState = z.infer<
  typeof LegacyBranchBaseLocalStateSchema
>;
const PersistedBranchBaseLocalStateSchema = z.discriminatedUnion("version", [
  LegacyBranchBaseLocalStateSchema,
  BranchBaseLocalStateSchema,
]);

const DEFAULT_INSTANCE_NAME = "Default";

const emptyState = (): BranchBaseLocalState => ({
  repositories: {},
  version: 2,
});

const routeLabel = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replaceAll(/-+$/gu, "");
  return normalized || "app";
};

const uniqueLabel = (base: string, used: Set<string>, id: string): string => {
  const candidate = routeLabel(base);
  if (!used.has(candidate)) {
    return candidate;
  }
  return `${candidate}-${id.replaceAll("-", "").slice(0, 6)}`;
};

const endpointKey = (groupId: string, appId: string): string =>
  `${groupId}\0${appId}`;

const instanceSelectionKey = (
  groupId: string,
  configFingerprint: string
): string => `${groupId}\0${configFingerprint}`;

const namesEqual = (left: string, right: string): boolean =>
  left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;

const cloneInstance = (instance: AppGroupInstance): AppGroupInstance =>
  structuredClone(instance);

const migrateLegacyState = (
  legacy: LegacyBranchBaseLocalState
): BranchBaseLocalState => {
  const repositories: Record<string, RepositoryRecord> = {};
  for (const [repoPath, repository] of Object.entries(legacy.repositories)) {
    const migrated: RepositoryRecord = {
      id: repository.id,
      instances: {},
      path: repository.path,
      routeLabel: repository.routeLabel,
      worktrees: {},
    };
    for (const [worktreePath, worktree] of Object.entries(
      repository.worktrees
    )) {
      migrated.worktrees[worktreePath] = {
        configSource: "project-default",
        id: worktree.id,
        instanceSelections: {},
        path: worktree.path,
        routeLabel: worktree.routeLabel,
      };
      const groupIds = new Set([
        ...Object.values(worktree.endpoints).map((item) => item.groupId),
        ...Object.keys(worktree.runs),
      ]);
      for (const groupId of groupIds) {
        const id = randomUUID();
        const legacyRun = worktree.runs[groupId];
        const endpoints = Object.fromEntries(
          Object.values(worktree.endpoints)
            .filter((endpoint) => endpoint.groupId === groupId)
            .map((endpoint) => [
              endpointKey(groupId, endpoint.appId),
              {
                ...endpoint,
                port: legacyRun?.apps[endpoint.appId]?.port ?? null,
              } satisfies EndpointAssignment,
            ])
        );
        migrated.instances[id] = {
          configFingerprint: "",
          endpoints,
          groupId,
          id,
          isDefault: false,
          mode: "per-worktree",
          name: worktree.routeLabel,
          routeLabel: worktree.routeLabel,
          run: legacyRun
            ? {
                ...legacyRun,
                instanceId: id,
                instanceIdsByGroup: { [groupId]: id },
                worktreePath,
              }
            : null,
          worktreePath,
        };
      }
    }
    repositories[repoPath] = migrated;
  }
  return { repositories, version: 2 };
};

const getRepositoryRecord = (
  state: BranchBaseLocalState,
  request: Pick<InstanceRequest, "repoLabel" | "repoPath">
): RepositoryRecord => {
  const existing = state.repositories[request.repoPath];
  if (existing) {
    return existing;
  }
  const id = randomUUID();
  const record: RepositoryRecord = {
    id,
    instances: {},
    path: request.repoPath,
    routeLabel: uniqueLabel(
      request.repoLabel,
      new Set(Object.values(state.repositories).map((item) => item.routeLabel)),
      id
    ),
    worktrees: {},
  };
  state.repositories[request.repoPath] = record;
  return record;
};

const getWorktreeRecord = (
  repository: RepositoryRecord,
  request: Pick<InstanceRequest, "worktreeLabel" | "worktreePath">
): WorktreeRecord => {
  const existing = repository.worktrees[request.worktreePath];
  if (existing) {
    return existing;
  }
  const id = randomUUID();
  const record: WorktreeRecord = {
    configSource: "project-default",
    id,
    instanceSelections: {},
    path: request.worktreePath,
    routeLabel: uniqueLabel(
      request.worktreeLabel,
      new Set([
        ...Object.values(repository.worktrees).map((item) => item.routeLabel),
        ...Object.values(repository.instances).map((item) => item.routeLabel),
      ]),
      id
    ),
  };
  repository.worktrees[request.worktreePath] = record;
  return record;
};

const getSelectedInstance = (
  repository: RepositoryRecord,
  worktree: WorktreeRecord,
  request: InstanceRequest
): AppGroupInstance | null => {
  if (request.mode === "per-worktree") {
    return (
      Object.values(repository.instances).find(
        (instance) =>
          (!instance.configFingerprint ||
            instance.configFingerprint === request.configFingerprint) &&
          instance.groupId === request.groupId &&
          instance.mode === "per-worktree" &&
          instance.worktreePath === request.worktreePath
      ) ?? null
    );
  }
  const selected =
    repository.instances[
      worktree.instanceSelections[
        instanceSelectionKey(request.groupId, request.configFingerprint)
      ] ??
        worktree.instanceSelections[request.groupId] ??
        ""
    ];
  if (
    selected?.groupId === request.groupId &&
    selected.mode === "selectable" &&
    (!selected.configFingerprint ||
      selected.configFingerprint === request.configFingerprint)
  ) {
    return selected;
  }
  return (
    Object.values(repository.instances).find(
      (instance) =>
        (!instance.configFingerprint ||
          instance.configFingerprint === request.configFingerprint) &&
        instance.groupId === request.groupId &&
        instance.mode === "selectable" &&
        instance.isDefault
    ) ?? null
  );
};

const makeInstanceRecord = (
  repository: RepositoryRecord,
  worktree: WorktreeRecord,
  request: InstanceRequest,
  input: {
    isDefault: boolean;
    name: string;
    worktreePath: string | null;
  }
): AppGroupInstance => {
  const id = randomUUID();
  const record: AppGroupInstance = {
    configFingerprint: request.configFingerprint,
    endpoints: {},
    groupId: request.groupId,
    id,
    isDefault: input.isDefault,
    mode: request.mode,
    name: input.name,
    routeLabel:
      request.mode === "per-worktree"
        ? worktree.routeLabel
        : uniqueLabel(
            input.name,
            new Set([
              ...Object.values(repository.instances).map(
                (item) => item.routeLabel
              ),
              ...Object.values(repository.worktrees).map(
                (item) => item.routeLabel
              ),
            ]),
            id
          ),
    run: null,
    worktreePath: input.worktreePath,
  };
  repository.instances[id] = record;
  return record;
};

export class FileBranchBaseStateStore {
  readonly path: string;

  constructor(path = pathModule.join(homedir(), ".branchbase", "state.json")) {
    this.path = path;
  }

  instance(request: InstanceRequest): AppGroupInstance {
    const state = this.read();
    const repositoryRecord = getRepositoryRecord(state, request);
    const worktreeRecord = getWorktreeRecord(repositoryRecord, request);
    const existing = getSelectedInstance(
      repositoryRecord,
      worktreeRecord,
      request
    );
    if (existing) {
      if (!existing.configFingerprint) {
        existing.configFingerprint = request.configFingerprint;
        this.write(state);
      }
      return cloneInstance(existing);
    }
    const instance = makeInstanceRecord(
      repositoryRecord,
      worktreeRecord,
      request,
      {
        isDefault: request.mode === "selectable",
        name:
          request.mode === "per-worktree"
            ? request.worktreeLabel
            : DEFAULT_INSTANCE_NAME,
        worktreePath:
          request.mode === "per-worktree" ? request.worktreePath : null,
      }
    );
    if (request.mode === "selectable") {
      worktreeRecord.instanceSelections[
        instanceSelectionKey(request.groupId, request.configFingerprint)
      ] = instance.id;
    }
    this.write(state);
    return cloneInstance(instance);
  }

  instances(
    repoPath: string,
    groupId: string,
    configFingerprint: string
  ): AppGroupInstance[] {
    const repository = this.read().repositories[repoPath];
    if (!repository) {
      return [];
    }
    return Object.values(repository.instances)
      .filter(
        (instance) =>
          instance.groupId === groupId &&
          instance.mode === "selectable" &&
          (!instance.configFingerprint ||
            instance.configFingerprint === configFingerprint)
      )
      .toSorted((left, right) => {
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map(cloneInstance);
  }

  worktreeConfigSource(
    repoPath: string,
    worktreePath: string
  ): WorktreeConfigSource {
    return (
      this.read().repositories[repoPath]?.worktrees[worktreePath]
        ?.configSource ?? "project-default"
    );
  }

  setWorktreeConfigSource(
    request: Pick<
      InstanceRequest,
      "repoLabel" | "repoPath" | "worktreeLabel" | "worktreePath"
    >,
    source: WorktreeConfigSource
  ): void {
    const state = this.read();
    const repositoryRecord = getRepositoryRecord(state, request);
    const worktreeRecord = getWorktreeRecord(repositoryRecord, request);
    worktreeRecord.configSource = source;
    this.write(state);
  }

  instanceById(repoPath: string, instanceId: string): AppGroupInstance | null {
    const instance = this.read().repositories[repoPath]?.instances[instanceId];
    return instance ? cloneInstance(instance) : null;
  }

  createSelectableInstance(
    request: InstanceRequest,
    name: string
  ): AppGroupInstance {
    if (request.mode !== "selectable") {
      throw new Error("Only selectable App groups can create named instances");
    }
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Instance name is required");
    }
    if (namesEqual(normalizedName, DEFAULT_INSTANCE_NAME)) {
      throw new Error(`Instance name "${DEFAULT_INSTANCE_NAME}" is reserved`);
    }
    const state = this.read();
    const repositoryRecord = getRepositoryRecord(state, request);
    const worktreeRecord = getWorktreeRecord(repositoryRecord, request);
    const duplicate = Object.values(repositoryRecord.instances).some(
      (instance) =>
        (!instance.configFingerprint ||
          instance.configFingerprint === request.configFingerprint) &&
        instance.groupId === request.groupId &&
        instance.mode === "selectable" &&
        namesEqual(instance.name, normalizedName)
    );
    if (duplicate) {
      throw new Error(`An instance named "${normalizedName}" already exists`);
    }
    const instance = makeInstanceRecord(
      repositoryRecord,
      worktreeRecord,
      request,
      {
        isDefault: false,
        name: normalizedName,
        worktreePath: null,
      }
    );
    worktreeRecord.instanceSelections[
      instanceSelectionKey(request.groupId, request.configFingerprint)
    ] = instance.id;
    this.write(state);
    return cloneInstance(instance);
  }

  selectInstance(
    request: InstanceRequest,
    instanceId: string
  ): AppGroupInstance {
    if (request.mode !== "selectable") {
      throw new Error(
        "Per-worktree App groups select their instance automatically"
      );
    }
    const state = this.read();
    const repositoryRecord = getRepositoryRecord(state, request);
    const worktreeRecord = getWorktreeRecord(repositoryRecord, request);
    const instance = repositoryRecord.instances[instanceId];
    if (
      !instance ||
      instance.groupId !== request.groupId ||
      instance.mode !== "selectable" ||
      (instance.configFingerprint &&
        instance.configFingerprint !== request.configFingerprint)
    ) {
      throw new Error("Unknown App-group instance");
    }
    if (!instance.configFingerprint) {
      instance.configFingerprint = request.configFingerprint;
    }
    worktreeRecord.instanceSelections[
      instanceSelectionKey(request.groupId, request.configFingerprint)
    ] = instance.id;
    this.write(state);
    return cloneInstance(instance);
  }

  endpoint(request: EndpointRequest): EndpointAssignment {
    const state = this.read();
    const repository = state.repositories[request.repoPath];
    const instance = repository?.instances[request.instanceId];
    if (!(repository && instance && instance.groupId === request.groupId)) {
      throw new Error(
        "App-group instance must be assigned before its endpoints"
      );
    }
    const key = endpointKey(request.groupId, request.appId);
    const existing =
      instance.endpoints[key] ?? instance.endpoints[request.appId];
    if (existing) {
      return structuredClone(existing);
    }
    const id = randomUUID();
    const label = uniqueLabel(
      request.appLabel,
      new Set(
        Object.values(repository.instances)
          .filter((candidate) => candidate.routeLabel === instance.routeLabel)
          .flatMap((candidate) =>
            Object.values(candidate.endpoints).map((item) => item.routeLabel)
          )
      ),
      id
    );
    const assignment: EndpointAssignment = {
      appId: request.appId,
      groupId: request.groupId,
      hostname: `${label}.${instance.routeLabel}.${repository.routeLabel}.localhost`,
      id,
      port: null,
      routeLabel: label,
    };
    instance.endpoints[key] = assignment;
    this.write(state);
    return structuredClone(assignment);
  }

  assignEndpointPort(
    key: RunKey,
    appId: string,
    port: number
  ): EndpointAssignment {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    const endpoint = instance?.endpoints[endpointKey(instance.groupId, appId)];
    if (!(instance && endpoint)) {
      throw new Error("Endpoint identity must be assigned before its port");
    }
    if (endpoint.port !== null && endpoint.port !== port) {
      throw new Error(`${appId} already has a stable backing port`);
    }
    endpoint.port = port;
    this.write(state);
    return structuredClone(endpoint);
  }

  run(key: RunKey): AppGroupRun | null {
    return structuredClone(
      this.read().repositories[key.repoPath]?.instances[key.instanceId]?.run ??
        null
    );
  }

  saveRun(key: RunKey, run: AppGroupRun): void {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    if (!instance) {
      throw new Error("App-group instance must exist before a run is saved");
    }
    instance.run = structuredClone(run);
    this.write(state);
  }

  removeRun(key: RunKey): void {
    const state = this.read();
    const instance =
      state.repositories[key.repoPath]?.instances[key.instanceId];
    if (!instance?.run) {
      return;
    }
    instance.run = null;
    this.write(state);
  }

  repositoryResources(repoPath: string): {
    hasRetainedRuns: boolean;
    worktreePaths: string[];
  } {
    const repository = this.read().repositories[repoPath];
    return {
      hasRetainedRuns: Object.values(repository?.instances ?? {}).some(
        (instance) => instance.run !== null
      ),
      worktreePaths: Object.values(repository?.worktrees ?? {}).map(
        (worktree) => worktree.path
      ),
    };
  }

  hasRunForWorktree(repoPath: string, worktreePath: string): boolean {
    const repository = this.read().repositories[repoPath];
    return repository
      ? Object.values(repository.instances).some(
          (instance) => instance.run?.worktreePath === worktreePath
        )
      : false;
  }

  runningInstancesForWorktree(
    repoPath: string,
    worktreePath: string
  ): AppGroupInstance[] {
    const repository = this.read().repositories[repoPath];
    return repository
      ? Object.values(repository.instances)
          .filter((instance) => instance.run?.worktreePath === worktreePath)
          .map(cloneInstance)
      : [];
  }

  leasedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const repository of Object.values(this.read().repositories)) {
      for (const instance of Object.values(repository.instances)) {
        for (const endpoint of Object.values(instance.endpoints)) {
          if (endpoint.port !== null) {
            ports.add(endpoint.port);
          }
        }
      }
    }
    return ports;
  }

  private read(): BranchBaseLocalState {
    if (!existsSync(this.path)) {
      return emptyState();
    }
    try {
      const value = PersistedBranchBaseLocalStateSchema.parse(
        JSON.parse(readFileSync(this.path, "utf-8"))
      );
      if (value.version === 1) {
        const migrated = migrateLegacyState(value);
        this.write(migrated);
        return migrated;
      }
      return value;
    } catch (error) {
      throw new Error(
        `Invalid BranchBase local state: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  private write(state: BranchBaseLocalState): void {
    mkdirSync(pathModule.dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      renameSync(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
