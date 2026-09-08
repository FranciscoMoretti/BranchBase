import type { WorkspaceController } from "../controller/workspace-controller";
import { appGroupIsStopped } from "../controller/workspace-snapshot";
import { delay } from "../runtime/async-utils";
import { findAppGroup } from "./start-apps";
import { stopApps } from "./stop-apps";

const STOP_ATTEMPTS = 50;
const STOP_POLL_MS = 100;

export const stopAppsAndWait = async (
  controller: WorkspaceController,
  input: { appGroupName: string; repoPath: string; worktreeId: string },
  timeoutMessage: string
): Promise<void> => {
  await stopApps(controller, input);
  for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt += 1) {
    const group = findAppGroup(
      controller.worktree(input.repoPath, input.worktreeId).worktree,
      input.appGroupName
    );
    if (appGroupIsStopped(group)) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Stop polling observes each attempt before waiting.
    await delay(STOP_POLL_MS);
  }
  throw new Error(timeoutMessage);
};
