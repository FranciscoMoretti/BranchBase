import { z } from "zod";

export const WorkspaceQuerySchema = z.object({ repoPath: z.string().min(1) });
export const LogsQuerySchema = WorkspaceQuerySchema.extend({
  appGroupName: z.string().min(1),
  worktreeId: z.string().min(1),
});

export const LogsResponseSchema = z.object({ lines: z.array(z.string()) });
export const SessionResponseSchema = z.object({ token: z.string().min(1) });
