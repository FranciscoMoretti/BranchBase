import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";
import { findAppGroup } from "./start-apps";

export const stopApps = async (
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const groupId = appGroupName.startsWith("cleanup:")
    ? appGroupName
    : findAppGroup(
        controller.worktree(repoPath, worktreeId).worktree,
        appGroupName
      ).id;
  const result = await controller.stopAppGroup(repoPath, worktreeId, groupId);
  return {
    appGroupName: groupId,
    command: "stop-apps",
    message:
      result === "already-stopped"
        ? `${appGroupName} is already stopped`
        : `Stopped ${appGroupName}`,
    ok: true,
    worktreeId,
  };
};
