import pathModule from "node:path";

import type { DaemonClient } from "./client";

export const CLI_HELP = `BranchBase

  branchbase daemon <start|status|stop>
  branchbase dashboard [--repo PATH]
  branchbase project list
  branchbase project status [--repo PATH]
  branchbase execute COMMAND --input JSON
  branchbase logs --repo PATH --worktree ID --group ID

Use --json for structured output. Commands use the same validation and approval
rules as the dashboard. Start the daemon before querying or executing commands.`;

const option = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

export const runCli = async (
  args: readonly string[],
  client: DaemonClient,
  cwd: string
): Promise<string> => {
  const [command, action] = args;
  if (!command || command === "help" || command === "--help") {
    return CLI_HELP;
  }
  // oxlint-disable-next-line no-use-before-define -- Keep the public entrypoint first.
  const result = await runCommand(command, action, args, client, cwd);
  if (!args.includes("--json") && typeof result === "string") {
    return result;
  }
  if (
    !args.includes("--json") &&
    result &&
    typeof result === "object" &&
    "message" in result &&
    typeof result.message === "string"
  ) {
    return result.message;
  }
  return JSON.stringify(result, null, 2);
};

const runCommand = (
  command: string,
  action: string | undefined,
  args: readonly string[],
  client: DaemonClient,
  cwd: string
): unknown => {
  if (command === "project") {
    if (action === "list") {
      return client.query("/api/projects");
    }
    if (action === "status" || action === "inspect") {
      return client.query("/api/project-status", {
        repoPath: pathModule.resolve(cwd, option(args, "--repo") ?? "."),
      });
    }
  }
  if (command === "execute" && action) {
    return client.execute(action, JSON.parse(option(args, "--input") ?? "{}"));
  }
  if (command === "logs") {
    // oxlint-disable-next-line no-use-before-define -- Helper is colocated with command handling.
    return runLogs(args, client, cwd);
  }
  throw new Error(CLI_HELP);
};

const runLogs = async (
  args: readonly string[],
  client: DaemonClient,
  cwd: string
): Promise<unknown> => {
  const worktreeId = option(args, "--worktree");
  const appGroupName = option(args, "--group");
  if (!worktreeId || !appGroupName) {
    throw new Error("Logs require --worktree ID and --group ID");
  }
  const result = await client.query("/api/logs", {
    appGroupName,
    repoPath: pathModule.resolve(cwd, option(args, "--repo") ?? "."),
    worktreeId,
  });
  if (
    !args.includes("--json") &&
    result &&
    typeof result === "object" &&
    "lines" in result &&
    Array.isArray(result.lines)
  ) {
    return result.lines.join("\n");
  }
  return result;
};
