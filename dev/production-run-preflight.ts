import { homedir } from "node:os";
import pathModule from "node:path";

import { findVerifiedWorktreeRun } from "../src/application/recorded-worktree-run-inspection";

export const assertProductionWorktreeAvailable = (
  worktreePath: string,
  options: { productionControlDirectory?: string } = {}
): void => {
  const productionControlDirectory =
    options.productionControlDirectory ??
    pathModule.join(homedir(), ".branchbase");
  const statePath = pathModule.join(productionControlDirectory, "state.json");
  let run: ReturnType<typeof findVerifiedWorktreeRun>;
  try {
    run = findVerifiedWorktreeRun(productionControlDirectory, worktreePath);
  } catch (error) {
    throw new Error(
      `Could not verify Production BranchBase state at ${statePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
  if (!run) {
    return;
  }
  throw new Error(
    `Production BranchBase already has ${run.groupId} running in ${run.worktreePath} on port ${run.port} (PID ${run.pid})`
  );
};
