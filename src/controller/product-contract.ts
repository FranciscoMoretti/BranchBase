import { z } from "zod";
import { ObservationSchema } from "./discovery-contract";
import { WorkspaceSnapshotSchema } from "./workspace-snapshot";

export const AppPinSchema = z.strictObject({
  appId: z.string().min(1),
  groupId: z.string().min(1),
  worktreeId: z.string().min(1),
});
export const ProjectRecordSchema = z.strictObject({
  addedAt: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1),
  pins: z.array(AppPinSchema).max(24),
});
export const ProjectOverviewSchema = ProjectRecordSchema.extend({
  observation: ObservationSchema.nullable().optional(),
  error: z.string().nullable(),
  workspace: WorkspaceSnapshotSchema.nullable(),
});
export const ProjectsResponseSchema = z.object({
  projects: z.array(ProjectOverviewSchema),
});
export type AppPin = z.infer<typeof AppPinSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;
