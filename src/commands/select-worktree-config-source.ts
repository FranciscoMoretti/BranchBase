import { WorktreeConfigSourceSchema } from "../config/worktree-config-source";
import type { WorkspaceController } from "../controller/workspace-controller";
import type { CommandReceipt } from "../controller/workspace-snapshot";
import { requiredString } from "./command";

export const selectWorktreeConfigSource = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  const worktreeId = requiredString(input.worktreeId, "Worktree");
  const source = WorktreeConfigSourceSchema.parse(
    requiredString(input.source, "Configuration source")
  );
  controller.selectWorktreeConfigSource(repoPath, worktreeId, source);
  return {
    command: "select-worktree-config-source",
    message:
      source === "checkout"
        ? "Using this worktree's configuration"
        : "Using the Project default configuration",
    ok: true,
    worktreeId,
  };
};
