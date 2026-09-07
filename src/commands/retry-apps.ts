import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";
import { findAppGroup } from "./start-apps";

export const retryApps = async (
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  const groupId = findAppGroup(
    controller.worktree(repoPath, worktreeId).worktree,
    appGroupName
  ).id;
  const result = await controller.retryAppGroup(repoPath, worktreeId, groupId);
  return {
    appGroupName: groupId,
    command: "retry-apps",
    message:
      result === "already-running"
        ? `${appGroupName} is already running`
        : `Retried ${appGroupName} readiness and routes`,
    ok: true,
    worktreeId,
  };
};
