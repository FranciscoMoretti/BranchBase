import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { ProcessSupervisor } from "./process-supervisor";

const worktreeId = `clear-log-test-${process.pid}`;
const stopTestId = `app-group-stop-test-${process.pid}`;
const stubbornStopTestId = `stubborn-app-group-stop-test-${process.pid}`;
const orphanCleanupTestId = `orphan-cleanup-test-${process.pid}`;
const DESCENDANT_PID_PATTERN = /descendant:(\d+)/;
let stubbornDescendantPid: number | null = null;
let stubbornOwnedPid: number | null = null;
let orphanDescendantPid: number | null = null;
let controlDirectory = "";
let supervisor: ProcessSupervisor;

beforeEach(() => {
  controlDirectory = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-process-test-")
  );
  supervisor = new ProcessSupervisor(controlDirectory);
});

const waitForProcessExit = async (pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} did not exit`);
};

afterEach(() => {
  rmSync(controlDirectory, { force: true, recursive: true });
  if (stubbornDescendantPid) {
    try {
      process.kill(stubbornDescendantPid, "SIGKILL");
    } catch {
      // The supervisor already terminated the stubborn descendant.
    }
    stubbornDescendantPid = null;
  }
  if (stubbornOwnedPid) {
    try {
      process.kill(stubbornOwnedPid, "SIGKILL");
    } catch {
      // The supervisor already terminated the stubborn owned process.
    }
    stubbornOwnedPid = null;
  }
  if (orphanDescendantPid) {
    try {
      process.kill(orphanDescendantPid, "SIGKILL");
    } catch {
      // The supervisor already terminated the orphaned descendant.
    }
    orphanDescendantPid = null;
  }
});

describe("managed logs", () => {
  it("ignores structurally invalid persisted process failures", () => {
    writeFileSync(
      pathModule.join(controlDirectory, `${worktreeId}.failure.json`),
      JSON.stringify({ failedAt: 42, message: ["not", "a", "message"] })
    );

    expect(supervisor.managedFailure(worktreeId)).toBeNull();
  });

  it("returns no phantom line after the terminal is cleared", () => {
    supervisor.appendManagedLog(worktreeId, "before clear");
    expect(supervisor.readManagedLog(worktreeId)).toEqual(["before clear"]);
    supervisor.clearManagedLog(worktreeId);
    expect(supervisor.readManagedLog(worktreeId)).toEqual([]);
  });

  it("contains and logs an executable spawn failure", async () => {
    expect(() =>
      supervisor.startManagedProcess({
        argv: [`missing-branchbase-command-${process.pid}`],
        cwd: process.cwd(),
        env: {},
        ownerRoot: process.cwd(),
        processId: worktreeId,
      })
    ).toThrow("Failed to start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(supervisor.readManagedLog(worktreeId).join("\n")).toContain(
      "Failed to start"
    );
  });

  it("ignores a delayed spawn failure after its control directory is removed", async () => {
    expect(() =>
      supervisor.startManagedProcess({
        argv: [`missing-branchbase-command-${process.pid}`],
        cwd: process.cwd(),
        env: {},
        ownerRoot: process.cwd(),
        processId: worktreeId,
        trackExitFailure: true,
      })
    ).toThrow("Failed to start");
    rmSync(controlDirectory, { force: true, recursive: true });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(existsSync(controlDirectory)).toBe(false);
  });

  it("rejects a configured working directory outside the worktree", () => {
    expect(() =>
      supervisor.startManagedProcess({
        argv: ["true"],
        cwd: "/tmp",
        env: {},
        ownerRoot: "/code/worktree",
        processId: worktreeId,
      })
    ).toThrow("must stay inside its worktree");
  });

  it("keeps a terminating app group managed until its process exits", async () => {
    const pid = supervisor.startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        'console.log("ready"); process.on("SIGTERM", () => setTimeout(() => process.exit(0), 200)); setInterval(() => {}, 1000);',
      ],
      cwd: process.cwd(),
      env: {},
      ownerRoot: process.cwd(),
      processId: stopTestId,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (supervisor.readManagedLog(stopTestId).includes("ready")) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const stopping = supervisor.stopManagedProcess(stopTestId, process.cwd());
    expect(supervisor.managedPid(stopTestId, process.cwd())).toBe(pid);
    expect(await stopping).toBe(pid);
    expect(supervisor.managedPid(stopTestId, process.cwd())).toBeNull();
  });

  it("force-stops descendants that ignore graceful termination", async () => {
    const pid = supervisor.startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"] }); child.stdout.once("data", () => console.log("descendant:" + child.pid)); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);`,
      ],
      cwd: process.cwd(),
      env: {},
      ownerRoot: process.cwd(),
      processId: stubbornStopTestId,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const match = supervisor
        .readManagedLog(stubbornStopTestId)
        .join("\n")
        .match(DESCENDANT_PID_PATTERN);
      if (match) {
        stubbornDescendantPid = Number(match[1]);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const descendantPid = stubbornDescendantPid;
    if (!descendantPid) {
      throw new Error("Stubborn descendant did not start");
    }
    expect(
      await supervisor.stopManagedProcess(stubbornStopTestId, process.cwd())
    ).toBe(pid);
    await waitForProcessExit(descendantPid);
  });

  it("stops descendants when their managed launcher exits unexpectedly", async () => {
    supervisor.startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log("descendant:" + child.pid); setTimeout(() => process.exit(1), 20);`,
      ],
      cwd: process.cwd(),
      env: {},
      ownerRoot: process.cwd(),
      processId: orphanCleanupTestId,
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const match = supervisor
        .readManagedLog(orphanCleanupTestId)
        .join("\n")
        .match(DESCENDANT_PID_PATTERN);
      if (match) {
        orphanDescendantPid = Number(match[1]);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const descendantPid = orphanDescendantPid;
    if (!descendantPid) {
      throw new Error("Orphaned descendant did not start");
    }
    await waitForProcessExit(descendantPid);
    orphanDescendantPid = null;
    expect(() => process.kill(descendantPid, 0)).toThrow();
  });

  it("force-stops an owned process outside the managed group", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    const childPid = child.pid;
    if (!childPid) {
      throw new Error("Stubborn owned process did not start");
    }
    stubbornOwnedPid = childPid;
    await new Promise<void>((resolve) => child.stdout.once("data", resolve));
    expect(
      await supervisor.stopOwnedProcess(childPid, stubbornStopTestId)
    ).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});
