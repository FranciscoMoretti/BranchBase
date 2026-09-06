import { z } from "zod";

const Usage = z.object({
  cpuPercent: z.number(),
  memoryBytes: z.number(),
  processCount: z.number(),
});
export const DetectedServiceSchema = z.object({
  pid: z.number(),
  port: z.number(),
  command: z.string(),
  cwd: z.string(),
  startedAt: z.string().nullable(),
  url: z.string().nullable(),
  address: z.string(),
  resources: Usage.nullable(),
  managed: z.boolean(),
});
export const ObservationSchema = z.object({
  resources: Usage.nullable().optional(),
  repoPath: z.string(),
  configured: z.boolean(),
  updatedAt: z.string(),
  warning: z.string().nullable(),
  worktrees: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      branch: z.string(),
      isMain: z.boolean(),
      services: z.array(DetectedServiceSchema),
    })
  ),
});
export const DevelopmentFolderSchema = z.object({
  path: z.string(),
  addedAt: z.string(),
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
