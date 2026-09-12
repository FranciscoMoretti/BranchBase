import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import pathModule from "node:path";
import { fileURLToPath } from "node:url";

import { pollUntil } from "../host/polling";

const cleanupFailedChild = (
  child: ChildProcess,
  stateDirectory: string
): void => {
  try {
    const pid = Number(
      readFileSync(pathModule.join(stateDirectory, "proxy.pid"), "utf-8")
    );
    if (pid === child.pid) {
      for (const file of [
        "branchbase-runtime.json",
        "proxy.pid",
        "proxy.port",
      ]) {
        const target = pathModule.join(stateDirectory, file);
        if (existsSync(target)) {
          unlinkSync(target);
        }
      }
    }
  } catch {
    // Startup cleanup is best effort and must never remove another runtime's files.
  }
};

const stopFailedChild = async (child: ChildProcess): Promise<void> => {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (exited()) {
    return;
  }
  child.kill("SIGTERM");
  try {
    await pollUntil(exited, {
      intervalMs: 20,
      message: "Routing proxy did not stop",
      timeoutMs: 500,
    });
  } catch {
    child.kill("SIGKILL");
    await pollUntil(exited, {
      intervalMs: 20,
      message: "Routing proxy did not exit",
      timeoutMs: 1000,
    });
  }
};

const waitForReady = async (
  child: ChildProcess,
  stateDirectory: string
): Promise<void> => {
  const { promise, resolve, reject }: PromiseWithResolvers<void> =
    Promise.withResolvers();
  const onError = (error: Error) => reject(error);
  const onExit = () =>
    reject(
      new Error("BranchBase routing proxy exited before startup completed")
    );
  const onMessage = (message: unknown) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    if (message.type === "ready") {
      resolve();
    } else if (message.type === "conflict") {
      reject(new Error("BranchBase routing proxy port is already in use"));
    } else if (message.type === "error") {
      reject(
        new Error(
          "message" in message
            ? String(message.message)
            : "BranchBase routing proxy failed"
        )
      );
    }
  };
  const timeout = setTimeout(
    () => reject(new Error("BranchBase routing proxy startup timed out")),
    5000
  );
  child.once("error", onError);
  child.once("exit", onExit);
  child.on("message", onMessage);
  try {
    await promise;
    if (child.connected) {
      child.disconnect();
    }
    child.unref();
  } catch (error) {
    await stopFailedChild(child);
    cleanupFailedChild(child, stateDirectory);
    throw error;
  } finally {
    clearTimeout(timeout);
    child.off("error", onError);
    child.off("exit", onExit);
    child.off("message", onMessage);
  }
};

/** The production proxy outlives its daemon so surviving App groups can be re-adopted. */
export const startProxyProcess = async (options: {
  nodePath: string;
  port: number;
  stateDirectory: string;
}): Promise<void> => {
  mkdirSync(options.stateDirectory, { mode: 0o700, recursive: true });
  const log = openSync(
    pathModule.join(options.stateDirectory, "proxy.log"),
    "a",
    0o600
  );
  let child: ChildProcess;
  try {
    child = fork(
      fileURLToPath(new URL("proxy-child.ts", import.meta.url)),
      [String(options.port), options.stateDirectory],
      {
        detached: true,
        execPath: options.nodePath,
        stdio: ["ignore", log, log, "ipc"],
      }
    );
  } finally {
    closeSync(log);
  }
  await waitForReady(child, options.stateDirectory);
};
