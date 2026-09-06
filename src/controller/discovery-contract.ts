import { z } from "zod";

export const ObservationSchema = z.object({
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
