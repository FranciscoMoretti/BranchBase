import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { loadBranchBaseConfig } from "../config/branchbase-config";
import { repositoryCommandFingerprint } from "../config/repository-trust";
import { delay } from "../runtime/async-utils";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import {
  ProcessSupervisor,
  setupProcessId,
} from "../runtime/process-supervisor";
import { AppGroupLifecycleError } from "./app-group-lifecycle-error";
import type { AppGroupTarget } from "./app-group-runtime";
import { WorkspaceController } from "./workspace-controller";

const directories: string[] = [];
const store = () => {
  const directory = realpathSync(
    mkdtempSync(pathModule.join(tmpdir(), "branchbase-product-"))
  );
  directories.push(directory);
  return { directory };
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});
const observedFixture = () => {
  const fixture = store();
  const repoPath = pathModule.join(fixture.directory, "repo");
  mkdirSync(repoPath);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
  };
  git("init", "-q");
  writeFileSync(
    pathModule.join(repoPath, ".branchbase.json"),
    JSON.stringify({
      appGroups: {
        service: {
          apps: { api: { protocol: "http", readiness: "tcp" } },
          instances: { mode: "selectable" },
          start: { argv: ["true"] },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 1,
    })
  );
  git("add", ".branchbase.json");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "-qm",
    "initial"
  );
  const runtime = pathModule.join(fixture.directory, "runtime");
  const state = new FileBranchBaseStateStore(
    pathModule.join(runtime, "state.json")
  );
  const controller = new WorkspaceController(undefined, {
    processes: new ProcessSupervisor(runtime),
    state,
  });
  return {
    ...fixture,
    controller,
    repoPath,
    snapshot: controller.inspect(repoPath),
    state,
  };
};

test("trust revocation preserves retained runtime ownership", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  try {
    controller.trustRepository(repoPath, [
      {
        fingerprint: snapshot.trustFingerprint,
      },
    ]);
    expect(controller.inspect(repoPath).trusted).toBe(true);
    const instanceId = snapshot.worktrees[0].appGroups[0].instance.id;
    state.saveRun(
      { instanceId, repoPath },
      {
        apps: {},
        createdAt: new Date().toISOString(),
        groupId: "service",
        instanceId,
        instanceIdsByGroup: { service: instanceId },
        stop: "process",
        worktreePath: repoPath,
      }
    );
    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    expect(state.run({ instanceId, repoPath })).not.toBeNull();
    expect(controller.inspect(repoPath).trusted).toBe(true);
  } finally {
    await controller.close();
  }
});

test("trust revocation blocks pending work on a persisted undiscovered worktree", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  const { processes } = controller as unknown as {
    processes: ProcessSupervisor;
  };
  const persistedWorktreePath = pathModule.join(repoPath, "persisted-worktree");
  let pending: Promise<unknown> | undefined;
  let managed:
    | ReturnType<ProcessSupervisor["listManagedProcesses"]>[number]
    | undefined;
  try {
    controller.trustRepository(repoPath, [
      { fingerprint: snapshot.trustFingerprint },
    ]);
    mkdirSync(persistedWorktreePath);
    const config = loadBranchBaseConfig(
      pathModule.join(repoPath, ".branchbase.json")
    );
    config.appGroups.service.start = {
      argv: ["sleep", "5"],
    };
    config.appGroups.service.apps.api.readiness = {
      path: "/",
      statuses: "200-399",
      timeoutSeconds: 1,
      type: "http",
    };
    state.instance({
      configFingerprint: repositoryCommandFingerprint(config),
      groupId: "service",
      mode: "per-worktree",
      repoLabel: "repo",
      repoPath,
      worktreeLabel: "persisted-worktree",
      worktreePath: persistedWorktreePath,
    });
    const { appGroups } = controller as unknown as {
      appGroups: {
        hasPendingLifecycle: (worktreePath: string) => boolean;
        start: (target: AppGroupTarget) => Promise<unknown>;
      };
    };
    pending = appGroups.start({
      config,
      groupId: "service",
      repoPath,
      worktree: {
        id: "persisted-worktree",
        path: persistedWorktreePath,
        routeLabel: "persisted-worktree",
      },
    });

    expect(appGroups.hasPendingLifecycle(persistedWorktreePath)).toBe(true);
    for (let attempt = 0; attempt < 100 && !managed; attempt += 1) {
      managed = processes
        .listManagedProcesses()
        .find((process) => process.cwd === persistedWorktreePath);
      if (!managed) {
        // oxlint-disable-next-line no-await-in-loop -- Managed process polling observes each attempt before waiting.
        await delay(10);
      }
    }
    expect(managed).toBeDefined();
    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    if (!managed) {
      throw new Error("Expected managed App-group process");
    }
    await processes.stopManagedProcess(managed.ownerId, persistedWorktreePath);
    const pendingError = await pending.then(
      () => null,
      (error) => error
    );
    expect(pendingError).toBeInstanceOf(AppGroupLifecycleError);
    expect(pendingError.code).toBe("readiness-failed");
    expect(controller.inspect(repoPath).trusted).toBe(true);
    expect(
      snapshot.worktrees.some(({ path }) => path === persistedWorktreePath)
    ).toBe(false);
  } finally {
    if (managed) {
      await processes.stopManagedProcess(
        managed.ownerId,
        persistedWorktreePath
      );
    }
    await pending?.catch(() => {});
    await controller.close();
  }
});

test("trust revocation blocks a setup process for a persisted worktree", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  const { processes } = controller as unknown as {
    processes: ProcessSupervisor;
  };
  const worktreePath = pathModule.join(repoPath, "persisted-setup-worktree");
  const markerPath = pathModule.join(worktreePath, "cwd-moved");
  let processId: string | undefined;
  try {
    controller.trustRepository(repoPath, [
      { fingerprint: snapshot.trustFingerprint },
    ]);
    mkdirSync(worktreePath);
    const worktreeId = Buffer.from(worktreePath).toString("base64url");
    const config = loadBranchBaseConfig(
      pathModule.join(repoPath, ".branchbase.json")
    );
    state.instance({
      configFingerprint: repositoryCommandFingerprint(config),
      groupId: "service",
      mode: "per-worktree",
      repoLabel: "repo",
      repoPath,
      worktreeLabel: "persisted-setup-worktree",
      worktreePath,
    });
    processId = setupProcessId(worktreeId);
    const pid = processes.startManagedProcess({
      argv: [
        "sh",
        "-c",
        'cd /tmp && touch "$1" && exec sleep 5',
        "setup-test",
        markerPath,
      ],
      cwd: worktreePath,
      env: process.env as Record<string, string>,
      label: "Setup",
      ownerId: worktreeId,
      ownerRoot: worktreePath,
      processId,
    });
    let managed = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (
        existsSync(markerPath) &&
        processes.managedPidByIdentity(processId, worktreeId) === pid
      ) {
        managed = true;
        break;
      }
      // oxlint-disable-next-line no-await-in-loop -- Managed process polling observes each attempt before waiting.
      await delay(10);
    }
    expect(managed).toBe(true);
    expect(
      processes.managedPidByIdentity(processId, `${worktreeId}-mismatch`)
    ).toBe(null);
    const persistedProcesses = new ProcessSupervisor(
      processes.controlDirectory
    );
    const persistedRecordPath = pathModule.join(
      processes.controlDirectory,
      `${processId}.pid`
    );
    const persistedRecord = JSON.parse(
      readFileSync(persistedRecordPath, "utf-8")
    ) as Record<string, unknown>;
    persistedRecord.ownerId = undefined;
    writeFileSync(persistedRecordPath, JSON.stringify(persistedRecord));
    expect(persistedProcesses.managedPidByIdentity(processId, worktreeId)).toBe(
      pid
    );
    expect(
      persistedProcesses.managedPidByIdentity(
        processId,
        `${worktreeId}-mismatch`
      )
    ).toBe(null);
    (controller as unknown as { processes: ProcessSupervisor }).processes =
      persistedProcesses;
    expect(() => controller.revokeTrust(repoPath)).toThrow(
      "finish setup processes"
    );
    expect(await processes.stopManagedProcess(processId, worktreePath)).toBe(
      pid
    );
  } finally {
    if (processId) {
      await processes.stopManagedProcess(processId, worktreePath);
    }
    rmSync(markerPath, { force: true });
    await controller.close();
  }
});

test("initializing a repository does not approve commands", async () => {
  const { controller, repoPath } = observedFixture();
  try {
    rmSync(pathModule.join(repoPath, ".branchbase.json"));
    controller.initializeRepository(repoPath);
    expect(controller.inspect(repoPath).trusted).toBe(false);
  } finally {
    await controller.close();
  }
});
