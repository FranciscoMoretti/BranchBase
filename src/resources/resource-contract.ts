import { z } from "zod";

export const ResourceEndpointSchema = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(["http", "tcp"]),
});
export const ExistingResourceSchema = z.strictObject({
  apps: z
    .record(z.string().min(1), ResourceEndpointSchema)
    .refine(
      (apps) => Object.keys(apps).length > 0,
      "At least one endpoint is required"
    ),
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  name: z.string().min(1),
});
export type ExistingResource = z.infer<typeof ExistingResourceSchema>;

export const WorktreeProfileSchema = z.strictObject({
  choices: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  connections: z.array(
    z.strictObject({
      error: z.string().optional(),
      groupId: z.string(),
      idle: z.enum(["keep-running", "stop-when-unused", "external"]),
      name: z.string(),
      policy: z.enum(["project", "worktree", "existing", "managed"]),
      resourceId: z.string(),
      resourceName: z.string(),
    })
  ),
  id: z.string(),
  name: z.string(),
  runningProfile: z.string().nullable(),
  source: z.enum(["override", "branch", "default"]),
});
