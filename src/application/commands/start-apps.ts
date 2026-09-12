import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";
import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

export const findAppGroup = (
  worktree: WorktreeSnapshot,
  appGroupName: string
): AppGroupSnapshot => {
  const group = worktree.appGroups.find((item) => item.id === appGroupName);
  if (!group) {
    throw new Error(`Unknown App group "${appGroupName}"`);
  }
  return group;
};

export const startApps = async (
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
  const result = await controller.startAppGroup(repoPath, worktreeId, groupId);
  return {
    appGroupName: groupId,
    command: "start-apps",
    message:
      result === "already-running"
        ? `${appGroupName} is already running`
        : `Started ${appGroupName}`,
    ok: true,
    worktreeId,
  };
};
