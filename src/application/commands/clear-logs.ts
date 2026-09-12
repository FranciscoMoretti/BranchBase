import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const clearLogs = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const appGroupName = requiredString(input.appGroupName, "App group");
  controller.clearLogs(repoPath, worktreeId, appGroupName);
  return {
    appGroupName,
    command: "clear-logs",
    message: `Cleared ${appGroupName} terminal`,
    ok: true,
    worktreeId,
  };
};
