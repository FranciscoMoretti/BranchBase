import { spawnSync } from "node:child_process";

import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export function deleteWorktree(
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const { workspace, worktree } = controller.worktree(repoPath, worktreeId);
  if (worktree.isMain) {
    throw new Error("The main worktree cannot be deleted");
  }
  const hasOwnedProcessGroup = worktree.appGroups.some(
    (group) =>
      group.stop === "process" &&
      (group.processRunning ||
        group.apps.some((app) => app.ownership === "owned"))
  );
  if (hasOwnedProcessGroup) {
    throw new Error(
      "Stop process-controlled App groups before deleting this worktree"
    );
  }
  const result = spawnSync("git", ["worktree", "remove", worktree.path], {
    cwd: workspace.mainWorktreePath,
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
  return {
    command: "delete-worktree",
    message: `Deleted ${worktree.name}`,
    ok: true,
    worktreeId,
  };
}
