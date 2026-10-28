import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import type { BranchBaseAppGroup } from "../../configuration/branchbase-schema";

/** Read only declared local inputs. Values never enter persisted run bindings. */
export const localCommandInputs = (
  group: BranchBaseAppGroup
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(group.inputs ?? {}).map(([key, input]) => [
      key,
      readFileSync(input.file, "utf-8").trimEnd(),
    ])
  );

export const commandEnvironment = (
  group: BranchBaseAppGroup,
  resolved: Record<string, string>
) => ({
  ...resolved,
  ...localCommandInputs(group),
  ...Object.fromEntries(
    Object.entries(resolved).filter(([key]) => group.env?.[key]?.includes("{"))
  ),
});

export const runBoundCommand = async (
  argv: string[],
  context: {
    cwd: string;
    env: Record<string, string>;
    inputs: Record<string, { file: string }>;
  },
  release: () => Promise<unknown>
) => {
  // Keep the CLI alive through child shutdown and lease release. A direct
  // signal to the CLI must reach the child as well as terminal group signals.
  let child: ReturnType<typeof spawn> | undefined;
  const forward = (signal: NodeJS.Signals) => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  for (const signal of signals) {
    process.on(signal, forward);
  }
  try {
    const secretInputs = Object.fromEntries(
      Object.entries(context.inputs).map(([key, input]) => [
        key,
        readFileSync(input.file, "utf-8").trimEnd(),
      ])
    );
    child = spawn(argv[0], argv.slice(1), {
      cwd: context.cwd,
      env: { ...process.env, ...secretInputs, ...context.env },
      stdio: "inherit",
    });
    const [code, signal] = await once(child, "exit");
    if (code !== 0) {
      throw new Error(`Command exited with ${signal ?? code}`);
    }
  } finally {
    try {
      await release();
    } finally {
      for (const signal of signals) {
        process.off(signal, forward);
      }
    }
  }
};

const parseResourceStatus = (stdout: string, instanceId: string): boolean => {
  let output: unknown;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(
      "Resource status must return JSON with instanceId and running"
    );
  }
  if (
    !output ||
    typeof output !== "object" ||
    !("instanceId" in output) ||
    output.instanceId !== instanceId ||
    !("running" in output) ||
    typeof output.running !== "boolean"
  ) {
    throw new Error("Resource status did not identify the selected instance");
  }
  return output.running;
};

const executeFile = promisify(execFile);

/** Dashboard observations must never block the daemon's event loop. */
export const observeManagedResourceRunning = async (
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  instanceId: string
): Promise<boolean> => {
  let stdout: string;
  try {
    ({ stdout } = await executeFile(argv[0], argv.slice(1), {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, ...env },
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      timeout: 5000,
    }));
  } catch {
    throw new Error(
      "Resource status command failed; ownership could not be verified"
    );
  }
  return parseResourceStatus(stdout, instanceId);
};

/** A detached owner's command must identify the exact instance it observed. */
export const managedResourceRunning = (
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  instanceId: string
): boolean => {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024,
    timeout: 5000,
  });
  if (result.status !== 0) {
    throw new Error(
      "Resource status command failed; ownership could not be verified"
    );
  }
  return parseResourceStatus(result.stdout, instanceId);
};
