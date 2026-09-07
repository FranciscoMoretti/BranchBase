import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

import { CodexHookActivityStore } from "../src/codex/codex-hook-activity";
import type { WorkspaceControllerRuntimeOptions } from "../src/controller/workspace-controller";
import { FileBranchBaseStateStore } from "../src/runtime/local-state";
import { ProcessSupervisor } from "../src/runtime/process-supervisor";
import { reserveBackingPort } from "../src/runtime/readiness";
import {
  DevelopmentProxyPortConflictError,
  DevelopmentRouting,
} from "./development-routing";
import {
  acquireExclusiveFileLock,
  ExclusiveFileLockBusyError,
} from "./exclusive-file-lock";
import { assertProductionWorktreeAvailable } from "./production-run-preflight";

const DEFAULT_PORTLESS_PORT = 1355;

export interface DevelopmentSessionProfile {
  codexControlDirectory: string;
  controlDirectory: string;
  dashboardPort: number;
  portlessPort: number;
  portlessStateDirectory: string;
  statePath: string;
}

export interface DevelopmentSession {
  close: () => Promise<void>;
  controllerRuntime: WorkspaceControllerRuntimeOptions;
  profile: DevelopmentSessionProfile;
}

interface OpenDevelopmentSessionOptions {
  appRoot: string;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

function configuredPort(
  value: string | undefined,
  fallback: number,
  label: string,
  allowZero = false
): number {
  if (value === undefined) {
    return fallback;
  }
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!(Number.isInteger(port) && port >= minimum && port <= 65_535)) {
    throw new Error(`${label} must be an integer between ${minimum} and 65535`);
  }
  return port;
}

function developmentProfileId(appRoot: string): string {
  return createHash("sha256")
    .update(realpathSync(appRoot))
    .digest("hex")
    .slice(0, 16);
}

function acquireDevelopmentOwnership(controlDirectory: string): () => void {
  mkdirSync(controlDirectory, { mode: 0o700, recursive: true });
  try {
    return acquireExclusiveFileLock(
      pathModule.join(controlDirectory, "server.lock.guard.sqlite")
    );
  } catch (error) {
    if (error instanceof ExclusiveFileLockBusyError) {
      throw new Error(
        "BranchBase development is already running for this checkout",
        { cause: error }
      );
    }
    throw error;
  }
}

async function prepareDevelopmentRouting(
  stateDirectory: string,
  port: number
): Promise<DevelopmentRouting> {
  const routing = await DevelopmentRouting.open({ port, stateDirectory });
  try {
    mkdirSync(stateDirectory, { mode: 0o700, recursive: true });
    writeFileSync(
      pathModule.join(stateDirectory, "development-proxy-port"),
      `${port}\n`
    );
    return routing;
  } catch (error) {
    await routing.close();
    throw error;
  }
}

function rememberedDevelopmentProxyPort(stateDirectory: string): number | null {
  try {
    const port = Number(
      readFileSync(
        pathModule.join(stateDirectory, "development-proxy-port"),
        "utf-8"
      ).trim()
    );
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function openDevelopmentRouting(
  stateDirectory: string,
  configuredPortValue: string | undefined
): Promise<DevelopmentRouting> {
  const rememberedPort = rememberedDevelopmentProxyPort(stateDirectory);
  if (configuredPortValue !== undefined) {
    const requestedPort = configuredPort(
      configuredPortValue,
      DEFAULT_PORTLESS_PORT,
      "BRANCHBASE_PORTLESS_PORT"
    );
    if (rememberedPort !== null && rememberedPort !== requestedPort) {
      throw new Error(
        `This checkout's development state uses Portless proxy port ${rememberedPort}; reset its isolated development state before changing to ${requestedPort}`
      );
    }
    return prepareDevelopmentRouting(stateDirectory, requestedPort);
  }
  if (rememberedPort !== null) {
    return prepareDevelopmentRouting(stateDirectory, rememberedPort);
  }
  let lastConflict: DevelopmentProxyPortConflictError | undefined;
  const conflictingPorts = new Set<number>();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reservation = await reserveBackingPort(conflictingPorts);
    const port = reservation.port;
    await reservation.release();
    try {
      return await prepareDevelopmentRouting(stateDirectory, port);
    } catch (error) {
      if (!(error instanceof DevelopmentProxyPortConflictError)) {
        throw error;
      }
      lastConflict = error;
      conflictingPorts.add(port);
    }
  }
  throw (
    lastConflict ??
    new Error("Could not allocate a Portless port for BranchBase development")
  );
}

export async function openDevelopmentSession(
  options: OpenDevelopmentSessionOptions
): Promise<DevelopmentSession> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const controlDirectory = pathModule.join(
    homeDirectory,
    ".branchbase",
    "development",
    developmentProfileId(options.appRoot)
  );
  const statePath = pathModule.join(controlDirectory, "state.json");
  const portlessStateDirectory = pathModule.join(controlDirectory, "portless");
  const codexControlDirectory = pathModule.join(controlDirectory, "codex");
  const dashboardPort = configuredPort(
    environment.BRANCHBASE_PORT,
    0,
    "BRANCHBASE_PORT",
    true
  );
  const releaseOwnership = acquireDevelopmentOwnership(controlDirectory);
  let routing: DevelopmentRouting | undefined;

  try {
    routing = await openDevelopmentRouting(
      portlessStateDirectory,
      environment.BRANCHBASE_PORTLESS_PORT
    );
    const profile: DevelopmentSessionProfile = {
      codexControlDirectory,
      controlDirectory,
      dashboardPort,
      portlessPort: routing.port,
      portlessStateDirectory,
      statePath,
    };
    let closePromise: Promise<void> | undefined;
    return {
      close() {
        closePromise ??= (async () => {
          try {
            await routing?.close();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `Could not stop the BranchBase development proxy: ${message}`
            );
          } finally {
            releaseOwnership();
          }
        })();
        return closePromise;
      },
      // oxlint-disable-next-line sort-keys -- Preserve controller resource initialization order.
      controllerRuntime: {
        codexHooks: new CodexHookActivityStore({
          file: pathModule.join(codexControlDirectory, "activity.json"),
        }),
        processes: new ProcessSupervisor(controlDirectory),
        routing,
        developmentStartPreflight: (worktreePath) => {
          assertProductionWorktreeAvailable(worktreePath, {
            productionControlDirectory: pathModule.join(
              homeDirectory,
              ".branchbase"
            ),
          });
        },
        state: new FileBranchBaseStateStore(statePath),
      },
      profile,
    };
  } catch (error) {
    try {
      await routing?.close();
    } catch {
      // Preserve the session startup failure after best-effort proxy cleanup.
    } finally {
      releaseOwnership();
    }
    throw error;
  }
}
