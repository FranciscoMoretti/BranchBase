import { z } from "zod";

import { ProcessUsageSchema } from "./worktree-status-contract";

export const DetectedServiceSchema = z.object({
  address: z.string(),
  command: z.string(),
  cwd: z.string(),
  managed: z.boolean(),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  resources: ProcessUsageSchema.nullable(),
  startedAt: z.string().nullable(),
  url: z.string().nullable(),
});
export const ObservationSchema = z.object({
  configured: z.boolean(),
  repoPath: z.string(),
  resources: ProcessUsageSchema.nullable().optional(),
  updatedAt: z.string(),
  warning: z.string().nullable(),
  worktrees: z.array(
    z.object({
      branch: z.string(),
      id: z.string(),
      isMain: z.boolean(),
      path: z.string(),
      services: z.array(DetectedServiceSchema),
    })
  ),
});
export const DevelopmentFolderSchema = z.object({
  addedAt: z.string(),
  path: z.string(),
});
export const FolderScanSchema = DevelopmentFolderSchema.extend({
  lastScannedAt: z.string().nullable(),
  projectsFound: z.number(),
  warning: z.string().nullable(),
});
export const FoldersResponseSchema = z.object({
  folders: z.array(FolderScanSchema),
});
export type Observation = z.infer<typeof ObservationSchema>;
export type DetectedService = z.infer<typeof DetectedServiceSchema>;
