import { expect, it } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { FileBranchBaseStateStore } from "../src/runtime/local-state";
import {
  appGroupInstanceProcessId,
  ProcessSupervisor,
} from "../src/runtime/process-supervisor";
import {
  reserveBackingPort,
  waitForAppReadiness,
} from "../src/runtime/readiness";
import { assertProductionWorktreeAvailable } from "./production-run-preflight";

function recordProductionRun(
  productionControlDirectory: string,
  worktreePath: string,
  port: number,
  options: { listenerClaimed?: boolean } = {}
): { instanceId: string } {
  const state = new FileBranchBaseStateStore(
    pathModule.join(productionControlDirectory, "state.json")
  );
  const instance = state.instance({
    configFingerprint: "production",
    groupId: "Chat",
    mode: "per-worktree",
    repoLabel: "chat-js",
    repoPath: worktreePath,
    worktreeLabel: "main",
    worktreePath,
  });
  state.endpoint({
    appId: "chat",
    appLabel: "chat",
    groupId: "Chat",
    instanceId: instance.id,
    repoPath: worktreePath,
  });
  state.assignEndpointPort(
    { instanceId: instance.id, repoPath: worktreePath },
    "chat",
    port
  );
  state.saveRun(
    { instanceId: instance.id, repoPath: worktreePath },
    {
      apps: {
        chat: {
          appId: "chat",
          directUrl: `http://127.0.0.1:${port}`,
          host: "127.0.0.1",
          ...(options.listenerClaimed ? { listenerClaimed: true } : {}),
          port,
          protocol: "http",
        },
      },
      createdAt: new Date().toISOString(),
      groupId: "Chat",
      instanceId: instance.id,
      instanceIdsByGroup: { Chat: instance.id },
      worktreePath,
    }
  );
  return { instanceId: instance.id };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGKILL");
  await once(child, "exit");
}

it("rejects a worktree with a verified production run", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-production-preflight-")
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const processes = new ProcessSupervisor(productionControlDirectory);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  const { instanceId } = recordProductionRun(
    productionControlDirectory,
    canonicalWorktreePath,
    port
  );
  const processId = appGroupInstanceProcessId(instanceId);

  try {
    await portReservation.release();
    const pid = processes.startManagedProcess({
      argv: [
        process.execPath,
        "-e",
        'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
      ],
      cwd: canonicalWorktreePath,
      env: { PORT: String(port) },
      label: "Chat",
      ownerRoot: canonicalWorktreePath,
      processId,
    });
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production BranchBase already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${pid})`
    );
  } finally {
    await processes.stopManagedProcess(processId, canonicalWorktreePath);
    await portReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("rejects an orphaned listener that still belongs to the worktree", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-production-listener-preflight-")
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  recordProductionRun(productionControlDirectory, canonicalWorktreePath, port);
  await portReservation.release();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
    ],
    {
      cwd: canonicalWorktreePath,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    }
  );

  try {
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production BranchBase already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${child.pid})`
    );
  } finally {
    await stopChild(child);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("rejects a claimed command-managed listener outside the worktree", async () => {
  const temporary = mkdtempSync(
    pathModule.join(
      tmpdir(),
      "branchbase-production-command-listener-preflight-"
    )
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();
  const port = portReservation.port;
  recordProductionRun(productionControlDirectory, canonicalWorktreePath, port, {
    listenerClaimed: true,
  });
  await portReservation.release();
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:http").createServer((_request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")',
    ],
    {
      cwd: temporary,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    }
  );

  try {
    await waitForAppReadiness(
      { protocol: "http", readiness: "tcp" },
      {
        appId: "chat",
        directUrl: `http://127.0.0.1:${port}`,
        host: "127.0.0.1",
        port,
        protocol: "http",
      }
    );

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow(
      `Production BranchBase already has Chat running in ${canonicalWorktreePath} on port ${port} (PID ${child.pid})`
    );
  } finally {
    await stopChild(child);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("ignores stale production state without a live process or listener", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-production-stale-preflight-")
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  mkdirSync(worktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();

  try {
    recordProductionRun(
      productionControlDirectory,
      canonicalWorktreePath,
      portReservation.port
    );
    await portReservation.release();

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).not.toThrow();
  } finally {
    await portReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("fails closed when a recorded worktree path cannot be resolved safely", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-production-path-error-preflight-")
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  const recordedWorktreePath = pathModule.join(temporary, "recorded-project");
  mkdirSync(worktreePath);
  symlinkSync(worktreePath, recordedWorktreePath);
  const canonicalWorktreePath = realpathSync(worktreePath);
  const portReservation = await reserveBackingPort();

  try {
    recordProductionRun(
      productionControlDirectory,
      recordedWorktreePath,
      portReservation.port
    );
    unlinkSync(recordedWorktreePath);
    symlinkSync(recordedWorktreePath, recordedWorktreePath);
    await portReservation.release();

    expect(() =>
      assertProductionWorktreeAvailable(canonicalWorktreePath, {
        productionControlDirectory,
      })
    ).toThrow("Could not verify Production BranchBase state");
  } finally {
    await portReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("fails closed when production state cannot be verified", () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-production-invalid-preflight-")
  );
  const productionControlDirectory = pathModule.join(
    temporary,
    "home",
    ".branchbase"
  );
  const worktreePath = pathModule.join(temporary, "project");
  mkdirSync(productionControlDirectory, { recursive: true });
  mkdirSync(worktreePath);
  writeFileSync(
    pathModule.join(productionControlDirectory, "state.json"),
    "not-json\n"
  );

  try {
    expect(() =>
      assertProductionWorktreeAvailable(worktreePath, {
        productionControlDirectory,
      })
    ).toThrow("Could not verify Production BranchBase state");
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});
