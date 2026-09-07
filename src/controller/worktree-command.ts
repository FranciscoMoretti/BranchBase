import { realpathSync } from "node:fs";
import pathModule from "node:path";

import { pathInside } from "../runtime/ports";

export const commandWorkingDirectory = (
  worktreePath: string,
  relativeCwd?: string
): string => {
  const root = realpathSync(worktreePath);
  let cwd: string;
  try {
    cwd = realpathSync(
      relativeCwd ? pathModule.resolve(root, relativeCwd) : root
    );
  } catch {
    throw new Error("Command working directory must exist inside the worktree");
  }
  if (!pathInside(cwd, root)) {
    throw new Error("Command working directory must stay inside the worktree");
  }
  return cwd;
};
