import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import pathModule from "node:path";

import { parseWorktreeList } from "./discover-worktrees";
import type { DiscoveredWorktree } from "./discover-worktrees";

export const git = (cwd: string, args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 3000,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "Git command failed").trim()
    );
  }
  return result.stdout.trim();
};

export const worktreeId = (path: string): string =>
  Buffer.from(realpathSync(path)).toString("base64url");

export interface ResolvedWorktree extends Omit<DiscoveredWorktree, "path"> {
  id: string;
  path: string;
}

export const resolveWorktrees = (repositoryRoot: string): ResolvedWorktree[] =>
  parseWorktreeList(git(repositoryRoot, ["worktree", "list", "--porcelain"]))
    .filter((item) => !item.prunable && existsSync(item.path))
    .map((item) => {
      const path = realpathSync(item.path);
      return { ...item, id: worktreeId(path), path };
    });

export const readOnlyWorktreePath = (
  repoPath: string,
  worktreeIdValue: string
): string => {
  let worktreePaths: string[];
  try {
    const selectedRoot = git(repoPath, ["rev-parse", "--show-toplevel"]);
    worktreePaths = resolveWorktrees(selectedRoot).map(({ path }) => path);
  } catch (error) {
    throw new Error(
      `Could not resolve BranchBase worktrees for "${repoPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  const worktreePath = worktreePaths.find(
    (path) => worktreeId(path) === worktreeIdValue
  );
  if (!worktreePath) {
    throw new Error("Unknown worktree");
  }
  return worktreePath;
};

export const projectAliasPaths = (repoPath: string): Set<string> => {
  const aliases = new Set([repoPath, pathModule.resolve(repoPath)]);
  if (!existsSync(repoPath)) {
    return aliases;
  }
  try {
    aliases.add(realpathSync(repoPath));
  } catch {
    return aliases;
  }
  try {
    const root = git(repoPath, ["rev-parse", "--show-toplevel"]);
    aliases.add(pathModule.resolve(root));
    for (const worktree of parseWorktreeList(
      git(repoPath, ["worktree", "list", "--porcelain"])
    )) {
      aliases.add(pathModule.resolve(worktree.path));
      if (existsSync(worktree.path)) {
        try {
          aliases.add(realpathSync(worktree.path));
        } catch {
          // A concurrently removed worktree is still covered by its saved path.
        }
      }
    }
    try {
      const commonDirectory = pathModule.resolve(
        repoPath,
        git(repoPath, ["rev-parse", "--git-common-dir"])
      );
      if (pathModule.basename(commonDirectory) === ".git") {
        aliases.add(pathModule.resolve(commonDirectory, ".."));
      }
    } catch {
      // The top-level root remains useful when common-dir discovery is unavailable.
    }
  } catch {
    // Removal must still work by the exact saved path when Git is unavailable.
  }
  return aliases;
};
