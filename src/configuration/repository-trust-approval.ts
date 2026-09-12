import { z } from "zod";

export const RepositoryTrustApprovalSchema = z.strictObject({
  fingerprint: z.string().min(1),
  worktreeId: z.string().min(1).optional(),
});

export type RepositoryTrustApproval = z.infer<
  typeof RepositoryTrustApprovalSchema
>;
