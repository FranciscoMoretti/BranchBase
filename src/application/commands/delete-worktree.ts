import { spawnSync } from "node:child_process";

import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const deleteWorktree = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const { mainWorktreePath, worktree } = controller.worktreeRemovalTarget(
    repoPath,
    worktreeId
  );
  const result = spawnSync("git", ["worktree", "remove", worktree.path], {
    cwd: mainWorktreePath,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        "Git refused to remove the worktree"
      ).trim()
    );
  }
  controller.forgetWorktreeDiskUsage(worktree.path);
  return {
    command: "delete-worktree",
    message: `Deleted ${worktree.branch}`,
    ok: true,
    worktreeId,
  };
};
