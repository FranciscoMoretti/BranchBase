import pathModule from "node:path";

import { git, resolveWorktrees } from "../adapters/git/project-worktrees";
import type { FileBranchBaseStateStore } from "../app-group/assignments";
import type { AppGroupRuntime } from "../app-group/lifecycle";
import {
  resolveProjectConfiguration,
  resolveWorktreeConfiguration,
} from "../configuration/resolution";

/** Assign identities explicitly, without allocating ports or executing repository code. */
export const reconcileProject = (
  repoPath: string,
  state: FileBranchBaseStateStore,
  appGroups: AppGroupRuntime
): void => {
  const worktrees = resolveWorktrees(
    git(repoPath, ["rev-parse", "--show-toplevel"])
  );
  const root = worktrees[0]?.path;
  if (!root) {
    throw new Error("No Git worktrees were discovered");
  }
  const project = resolveProjectConfiguration(root);
  if (!project) {
    return;
  }
  for (const worktree of worktrees) {
    const effective = resolveWorktreeConfiguration(
      project,
      worktree.path,
      state.worktreeConfigSource(root, worktree.path)
    );
    const [groupId] = Object.keys(effective.document.config.appGroups);
    if (groupId) {
      appGroups.reconcile({
        config: effective.document.config,
        groupId,
        repoPath: root,
        worktree: {
          ...worktree,
          routeLabel: worktree.branch ?? pathModule.basename(worktree.path),
        },
      });
    }
  }
};
