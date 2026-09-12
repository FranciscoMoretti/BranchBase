import { WorktreeConfigSourceSchema } from "../../configuration/worktree-config-source";
import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
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
