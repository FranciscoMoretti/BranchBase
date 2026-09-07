import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export const selectAppGroupInstance = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const instanceId = requiredString(input.instanceId, "Instance");
  const instance = controller.selectAppGroupInstance(
    repoPath,
    worktreeId,
    appGroupName,
    instanceId
  );
  return {
    appGroupName,
    command: "select-app-group-instance",
    message: `Selected ${instance.name}`,
    ok: true,
    worktreeId,
  };
};
