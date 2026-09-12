import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import pathModule from "node:path";

import type { CommandReceipt } from "../command-contract";
import type { WorkspaceController } from "../workspace-controller";
import { requiredString } from "./command";

const BRANCH_PATTERN = /^[A-Za-z0-9._/@-]+$/u;
const FOLDER_PATTERN = /^[A-Za-z0-9._-]+$/u;

const run = (argv: string[], cwd: string, env = process.env): string => {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `${command} failed`).trim()
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
};

export const createWorktree = (
  controller: WorkspaceController,
  input: Record<string, unknown>
): CommandReceipt => {
  const repoPath = requiredString(input.repoPath, "Repository path");
  controller.assertTrusted(repoPath);
  const branch = requiredString(input.branch, "Branch");
  const createBranch = input.createBranch !== false;
  if (branch.startsWith("-") || !BRANCH_PATTERN.test(branch)) {
    throw new Error("Branch contains unsupported characters");
  }
  const workspace = controller.inspect(repoPath);
  const folderName = requiredString(input.folderName, "Folder name");
  if (!FOLDER_PATTERN.test(folderName)) {
    throw new Error(
      "Folder name can only contain letters, numbers, dot, underscore, and dash"
    );
  }
  const target = pathModule.join(
    pathModule.dirname(workspace.mainWorktreePath),
    folderName
  );
  if (existsSync(target)) {
    throw new Error(`Target path already exists: ${target}`);
  }
  const gitArgs = createBranch
    ? ["git", "worktree", "add", "-b", branch, target]
    : ["git", "worktree", "add", target, branch];
  run(gitArgs, workspace.mainWorktreePath);

  const created = controller
    .inspect(target)
    .worktrees.find(
      (worktree) =>
        worktree.path === target ||
        pathModule.basename(worktree.path) === folderName
    );
  if (!created) {
    throw new Error("Worktree was created but could not be rediscovered");
  }
  controller.startSetup(target, created.id);
  return {
    command: "create-worktree",
    completion: "accepted",
    message: `Created ${folderName}; setup is running`,
    ok: true,
    worktreeId: created.id,
  };
};
