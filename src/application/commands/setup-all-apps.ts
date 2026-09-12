import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString, selectRequestedWorktrees } from "./command";

export const setupAllApps = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const workspace = controller.inspect(repoPath);
  const targets = selectRequestedWorktrees(
    workspace.worktrees,
    input.worktreeIds
  );
  if (targets.length === 0) {
    controller.assertTrusted(repoPath);
  }
  for (const worktree of targets) {
    controller.assertTrusted(repoPath, worktree.id);
  }
  for (const worktree of targets) {
    controller.startSetup(repoPath, worktree.id);
  }
  return {
    command: "setup-all-apps",
    completion: "accepted",
    message: `Started setup in ${targets.length} worktree${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
};
