import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString, selectRequestedWorktrees } from "./command";
import { stopApps } from "./stop-apps";

export const stopAllApps = async (
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
    worktree.appGroups.flatMap((group) => {
      if (
        (requestedGroup && group.id !== requestedGroup) ||
        !appGroupIsRunning(group)
      ) {
        return [];
      }
      return [{ appGroupName: group.id, worktreeId: worktree.id }];
    })
  );
  for (const target of targets) {
    // oxlint-disable-next-line no-await-in-loop -- App group lifecycle operations are serialized to preserve stop ordering.
    await stopApps(controller, { repoPath, ...target });
  }
  return {
    command: "stop-all-apps",
    message: `Stopped ${targets.length} App group${targets.length === 1 ? "" : "s"}`,
    ok: true,
  };
};
