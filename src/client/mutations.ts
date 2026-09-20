import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
  BranchBaseCommandName,
  BranchBaseCommandInput,
} from "../application/command-contract";
import { runCommand } from "./api";
import { invalidateCommandQueries } from "./command-invalidation";

export const useCommand = <Name extends BranchBaseCommandName>(
  command: Name,
  repoPath?: string
) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BranchBaseCommandInput<Name>) =>
      runCommand(command, input),
    mutationKey: ["command", command, repoPath],
    onSettled: (_result, _error, input) =>
      invalidateCommandQueries(client, command, input),
  });
};

export const useCommands = (repoPath: string) => {
  const clearLogs = useCommand("clear-logs", repoPath);
  const createAppGroupInstance = useCommand(
    "create-app-group-instance",
    repoPath
  );
  const setupAllApps = useCommand("setup-all-apps", repoPath);
  const startApps = useCommand("start-apps", repoPath);
  const startAllApps = useCommand("start-all-apps", repoPath);
  const restartApps = useCommand("restart-apps", repoPath);
  const retryApps = useCommand("retry-apps", repoPath);
  const restartRunningApps = useCommand("restart-running-apps", repoPath);
  const selectAppGroupInstance = useCommand(
    "select-app-group-instance",
    repoPath
  );
  const selectWorktreeConfigSource = useCommand(
    "select-worktree-config-source",
    repoPath
  );
  const stopApps = useCommand("stop-apps", repoPath);
  const stopAllApps = useCommand("stop-all-apps", repoPath);
  const trustRepository = useCommand("trust-repository", repoPath);
  const updateRepositoryConfig = useCommand(
    "update-repository-config",
    repoPath
  );
  const createWorktree = useCommand("create-worktree", repoPath);
  const deleteWorktree = useCommand("delete-worktree", repoPath);
  const mutations = {
    clearLogs,
    createAppGroupInstance,
    createWorktree,
    deleteWorktree,
    restartApps,
    restartRunningApps,
    retryApps,
    selectAppGroupInstance,
    selectWorktreeConfigSource,
    setupAllApps,
    startAllApps,
    startApps,
    stopAllApps,
    stopApps,
    trustRepository,
    updateRepositoryConfig,
  };
  // Dialogs present their own errors next to the submitted fields.
  const [latest] = Object.entries(mutations)
    .filter(
      ([name]) =>
        ![
          "createWorktree",
          "deleteWorktree",
          "trustRepository",
          "updateRepositoryConfig",
        ].includes(name)
    )
    .filter(([, mutation]) => mutation.error)
    .map(([, mutation]) => mutation)
    .toSorted((a, b) => b.submittedAt - a.submittedAt);
  return { ...mutations, error: latest?.error ?? null };
};
