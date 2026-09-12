import { z } from "zod";

import { ObservationSchema } from "./discovery-contract";
import {
  AppGroupSnapshotSchema,
  WorkspaceSnapshotSchema,
} from "./worktree-status-contract";

export const ProjectConfigurationStateSchema = z.enum([
  "unconfigured",
  "invalid",
  "ready",
]);

export const ProjectStatusWorktreeSchema = z.strictObject({
  branch: z.string(),
  id: z.string(),
  isMain: z.boolean(),
  path: z.string(),
});

export const RetainedCleanupTargetSchema = z.strictObject({
  groupId: z.string(),
  instanceId: z.string(),
  name: z.string(),
  worktreePath: z.string(),
});

/**
 * Project status is a live read. `workspace` is populated only when the
 * Project default configuration is valid; Git facts remain available for
 * every configuration state.
 */
export const ProjectStatusSchema = z.strictObject({
  cleanupAppGroups: z.array(AppGroupSnapshotSchema),
  configuration: z.strictObject({
    error: z.string().nullable(),
    state: ProjectConfigurationStateSchema,
  }),
  issues: z.array(
    z.strictObject({
      area: z.enum(["configuration", "runtime", "observation"]),
      code: z.string(),
      message: z.string(),
    })
  ),
  observation: ObservationSchema.nullable(),
  repoName: z.string(),
  repoPath: z.string(),
  retainedCleanupTargets: z.array(RetainedCleanupTargetSchema),
  updatedAt: z.string(),
  workspace: WorkspaceSnapshotSchema.nullable(),
  worktrees: z.array(ProjectStatusWorktreeSchema),
});

export type ProjectConfigurationState = z.infer<
  typeof ProjectConfigurationStateSchema
>;
export type ProjectStatusWorktree = z.infer<typeof ProjectStatusWorktreeSchema>;
export type RetainedCleanupTarget = z.infer<typeof RetainedCleanupTargetSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
