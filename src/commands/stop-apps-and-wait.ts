import type { WorkspaceController } from "../controller/workspace-controller";
import { appGroupIsStopped } from "../controller/workspace-snapshot";
import { pollUntil } from "../runtime/async-utils";
import { findAppGroup } from "./start-apps";
import { stopApps } from "./stop-apps";

const STOP_POLL_MS = 100;

export const stopAppsAndWait = async (
  controller: WorkspaceController,
  input: { appGroupName: string; repoPath: string; worktreeId: string },
  timeoutMessage: string
): Promise<void> => {
  await stopApps(controller, input);
  await pollUntil(
    () =>
      appGroupIsStopped(
        findAppGroup(
          controller.worktree(input.repoPath, input.worktreeId).worktree,
          input.appGroupName
        )
      ),
    {
      intervalMs: STOP_POLL_MS,
      maxAttempts: 50,
      message: timeoutMessage,
    }
  );
};
