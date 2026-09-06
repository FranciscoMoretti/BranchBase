import { z } from "zod";

import { BranchBaseConfigSchema } from "../config/branchbase-schema";
import { WorktreeConfigSourceSchema } from "../config/worktree-config-source";
import type { CommandReceiptSchema } from "./command-contract";

export type { WorktreeConfigSource } from "../config/worktree-config-source";

export const ProcessUsageSchema = z.object({
  memoryBytes: z.number().nonnegative(),
  cpuPercent: z.number().nonnegative(),
  processCount: z.number().int().nonnegative(),
});

const AppHealthSchema = z.enum(["not-running", "partially-running", "running"]);

export const AppEndpointSnapshotSchema = z.strictObject({
  directUrl: z.string().nullable(),
  id: z.string(),
  label: z.string(),
  listening: z.boolean(),
  open: z.boolean(),
  ownership: z.enum(["owned", "foreign", "none"]),
  port: z.number().int().nullable(),
  protocol: z.enum(["http", "tcp"]),
  readiness: z.enum(["ready", "unready", "waiting"]),
  routeState: z.enum(["inactive", "active", "conflict", "unavailable"]),
  url: z.string().nullable(),
});

export const AppGroupSnapshotSchema = z.strictObject({
  category: z.enum(["application", "infrastructure"]).optional(),
  pending: z.boolean().optional(),
  resources: ProcessUsageSchema.nullable().optional(),
  run: z
    .object({ startedAt: z.string(), worktreePath: z.string() })
    .nullable()
    .optional(),
  dependencies: z
    .array(
      z.object({
        groupId: z.string(),
        instanceId: z.string(),
        name: z.string(),
      })
    )
    .optional(),
  apps: z.array(AppEndpointSnapshotSchema),
  cleanupOnly: z.boolean().optional(),
  health: AppHealthSchema,
  id: z.string().min(1),
  instance: z.strictObject({
    id: z.string().min(1),
    mode: z.enum(["per-worktree", "selectable"]),
    name: z.string().min(1),
  }),
  instances: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      running: z.boolean(),
    })
  ),
  name: z.string().min(1),
  processRunning: z.boolean(),
  stop: z.enum(["command", "process"]),
});

export const WorktreeSnapshotSchema = z.strictObject({
  appGroups: z.array(AppGroupSnapshotSchema),
  appLabel: z.string(),
  apps: z.array(AppEndpointSnapshotSchema),
  branch: z.string(),
  configuration: z.strictObject({
    changeBlocked: z.boolean(),
    error: z.string().nullable(),
    path: z.string(),
    preference: WorktreeConfigSourceSchema,
    revision: z.string().min(1),
    source: WorktreeConfigSourceSchema,
    trustCommands: z.array(z.string()),
    trustFingerprint: z.string().min(1),
    trusted: z.boolean(),
  }),
  health: AppHealthSchema,
  id: z.string(),
  isMain: z.boolean(),
  name: z.string(),
  path: z.string(),
  primaryAppGroup: z.string().min(1),
  processRunning: z.boolean(),
  setupState: z.enum(["failed", "idle", "running"]),
});

export const WorkspaceSnapshotSchema = z.strictObject({
  globalProcesses: z.array(
    z.strictObject({
      argv: z.array(z.string()),
      cwd: z.string(),
      label: z.string(),
      ownerId: z.string(),
      pid: z.number().int().positive(),
      startedAt: z.string(),
    })
  ),
  globalRunningCount: z.number().int().nonnegative(),
  resources: ProcessUsageSchema.nullable().optional(),
  mainWorktreePath: z.string(),
  projectDefaultConfig: BranchBaseConfigSchema,
  projectDefaultConfigPath: z.string(),
  projectDefaultConfigRevision: z.string().min(1),
  projectDefaultPrimaryAppGroup: z.string().min(1),
  repoName: z.string(),
  repoPath: z.string(),
  trustCommands: z.array(z.string()),
  trustFingerprint: z.string().min(1),
  trustRequired: z.boolean(),
  trusted: z.boolean(),
  updatedAt: z.string(),
  worktrees: z.array(WorktreeSnapshotSchema),
});

export type AppHealth = z.infer<typeof AppHealthSchema>;
export type AppEndpointSnapshot = z.infer<typeof AppEndpointSnapshotSchema>;
export type AppGroupSnapshot = z.infer<typeof AppGroupSnapshotSchema>;
export type GlobalProcessSnapshot = z.infer<
  typeof WorkspaceSnapshotSchema.shape.globalProcesses.element
>;
export type WorktreeSnapshot = z.infer<typeof WorktreeSnapshotSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

export function appGroupIsRunning(
  group: Pick<AppGroupSnapshot, "cleanupOnly" | "health" | "processRunning">
): boolean {
  return (
    group.cleanupOnly === true ||
    group.health !== "not-running" ||
    group.processRunning
  );
}

export function appGroupIsStopped(
  group: Pick<AppGroupSnapshot, "cleanupOnly" | "health" | "processRunning">
): boolean {
  return !appGroupIsRunning(group);
}

export function appGroupCanRestart(
  group: Pick<AppGroupSnapshot, "cleanupOnly" | "health" | "processRunning">
): boolean {
  return group.cleanupOnly !== true && appGroupIsRunning(group);
}

export function worktreeHasRunningAppGroups(
  worktree: Pick<WorktreeSnapshot, "appGroups">
): boolean {
  return worktree.appGroups.some(
    (group) =>
      appGroupIsRunning(group) ||
      group.instances.some((instance) => instance.running)
  );
}

export function appsAreRunning(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning"> &
    Partial<Pick<WorktreeSnapshot, "appGroups">>
): boolean {
  if (worktree.appGroups) {
    return worktree.appGroups.some(appGroupIsRunning);
  }
  return worktree.health !== "not-running" || worktree.processRunning;
}

export function appsAreStopped(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning"> &
    Partial<Pick<WorktreeSnapshot, "appGroups">>
): boolean {
  return !appsAreRunning(worktree);
}

export function appsCanRestart(
  worktree: Pick<WorktreeSnapshot, "health" | "processRunning"> &
    Partial<Pick<WorktreeSnapshot, "appGroups">>
): boolean {
  return worktree.appGroups
    ? worktree.appGroups.some(appGroupCanRestart)
    : appsAreRunning(worktree);
}
