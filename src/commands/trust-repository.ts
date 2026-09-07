import { RepositoryTrustApprovalSchema } from "../config/repository-trust-approval";
import type { RepositoryTrustApproval } from "../config/repository-trust-approval";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function trustRepository(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const approvals = Array.isArray(input.approvals)
    ? input.approvals.map((approval) =>
        RepositoryTrustApprovalSchema.parse(approval)
      )
    : ([] satisfies RepositoryTrustApproval[]);
  if (approvals.length === 0) {
    throw new Error("At least one reviewed command fingerprint is required");
  }
  controller.trustRepository(repoPath, approvals);
  return {
    command: "trust-repository",
    message: "Trusted repository commands",
    ok: true,
  };
}
