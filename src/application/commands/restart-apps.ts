import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";
import { findAppGroup } from "./start-apps";

export const restartApps = async (
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const current = findAppGroup(
    controller.worktree(repoPath, worktreeId).worktree,
    appGroupName
  );
  if (!appGroupIsRunning(current)) {
    throw new Error(
      `${appGroupName} must be running before it can be restarted`
    );
  }
  await controller.restartAppGroup(repoPath, worktreeId, current.id);
  return {
    command: "restart-apps",
    message: `Restarted ${appGroupName}`,
    ok: true,
    worktreeId,
  };
};
