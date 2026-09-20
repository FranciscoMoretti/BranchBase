import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type {
  BranchBaseCommandInput,
  BranchBaseCommandName,
} from "../application/command-contract";

type Effect = "none" | "folders" | "catalog" | "project" | "runtime" | "logs";

const effects = {
  "add-development-folder": "folders",
  "clear-logs": "logs",
  "create-app-group-instance": "runtime",
  "create-worktree": "runtime",
  "delete-worktree": "runtime",
  "initialize-repository": "project",
  "pick-repository": "none",
  "preview-repository-config": "none",
  "remove-development-folder": "folders",
  "remove-project": "project",
  "restart-apps": "runtime",
  "restart-running-apps": "runtime",
  "retry-apps": "runtime",
  "revoke-trust": "project",
  "save-project": "catalog",
  "scan-development-folders": "folders",
  "select-app-group-instance": "runtime",
  "select-worktree-config-source": "runtime",
  "setup-all-apps": "runtime",
  "start-all-apps": "runtime",
  "start-apps": "runtime",
  "stop-all-apps": "runtime",
  "stop-apps": "runtime",
  "trust-repository": "project",
  "update-repository-config": "runtime",
} satisfies Record<BranchBaseCommandName, Effect>;

export const invalidateCommandQueries = async <
  Name extends BranchBaseCommandName,
>(
  client: QueryClient,
  command: Name,
  input: BranchBaseCommandInput<Name>
): Promise<void> => {
  const effect = effects[command];
  const keys: QueryKey[] = [];
  const repoPath = "repoPath" in input ? input.repoPath : undefined;
  if (effect === "folders") {
    keys.push(["development-folders"], ["projects"]);
  } else if (effect !== "none" && effect !== "logs") {
    keys.push(["projects"]);
  }
  if (repoPath && (effect === "project" || effect === "runtime")) {
    keys.push(
      ["project-status", repoPath],
      ["workspace", repoPath],
      ["observation", repoPath]
    );
  }
  if (repoPath && effect !== "none") {
    keys.push(["activity", repoPath], ["activity", "all"]);
  }
  if (repoPath && (effect === "logs" || effect === "runtime")) {
    // Several worktrees can select the same instance. Its output changes for
    // every alias, including after a partially failed lifecycle command.
    keys.push(["logs", repoPath]);
  }
  await Promise.all(
    keys.map((queryKey) => client.invalidateQueries({ queryKey }))
  );
};
