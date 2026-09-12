import type { BranchBaseConfig } from "../../configuration/branchbase-schema";
import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const updateRepositoryConfig = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  controller.updateConfiguration(
    requiredString(input.repoPath, "Repository path"),
    input.config as BranchBaseConfig,
    requiredString(input.revision, "Configuration revision")
  );
  return {
    command: "update-repository-config",
    message: "Saved repository configuration",
    ok: true,
  };
};
