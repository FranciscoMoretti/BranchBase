import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appGroupIsStopped } from "../controller/workspace-snapshot";
import { requiredString, selectRequestedWorktrees } from "./command";
import { startApps } from "./start-apps";

export const startAllApps = async (
  controller: WorkspaceController,
  input: Record<string, unknown>
): Promise<CommandReceipt> => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const requestedGroup =
    typeof input.appGroupName === "string" ? input.appGroupName : null;
  const worktrees = selectRequestedWorktrees(
    controller.inspect(repoPath).worktrees,
    input.worktreeIds
  );
  const targets = worktrees.flatMap((worktree) =>
    worktree.appGroups
      .filter(
        (group) =>
          (!requestedGroup || group.id === requestedGroup) &&
          appGroupIsStopped(group)
      )
      .map((group) => ({ appGroupName: group.id, worktreeId: worktree.id }))
  );
  for (const target of targets) {
    await startApps(controller, { repoPath, ...target });
  }
  return {
    command: "start-all-apps",
    message: `Started ${targets.length} App group${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
};
