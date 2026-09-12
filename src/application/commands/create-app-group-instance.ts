import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const createAppGroupInstance = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const name = requiredString(input.name, "Instance name");
  const instance = controller.createAppGroupInstance(
    repoPath,
    worktreeId,
    appGroupName,
    name
  );
  return {
    appGroupName,
    command: "create-app-group-instance",
    message: `Created and selected ${instance.name}`,
    ok: true,
    worktreeId,
  };
};
