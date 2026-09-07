import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { appGroupIsRunning } from "../controller/workspace-snapshot";
import { requiredString } from "./command";
import { findAppGroup, startApps } from "./start-apps";
import { stopAppsAndWait } from "./stop-apps-and-wait";

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
  await stopAppsAndWait(
    controller,
    { appGroupName, repoPath, worktreeId },
    `${appGroupName} did not stop within 5 seconds; restart was cancelled`
  );
  const started = await startApps(controller, {
    appGroupName,
    repoPath,
    worktreeId,
  });
  return {
    ...started,
    command: "restart-apps",
    message: `Restarted ${appGroupName}`,
  };
};
