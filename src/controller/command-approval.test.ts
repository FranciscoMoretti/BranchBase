import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBranchBaseConfig } from "../config/branchbase-config";
import { repositoryCommandFingerprint } from "../config/repository-trust";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import {
  ProcessSupervisor,
  setupProcessId,
} from "../runtime/process-supervisor";
import type { AppGroupTarget } from "./app-group-runtime";
import { WorkspaceController } from "./workspace-controller";

const directories: string[] = [];
function store() {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "branchbase-product-"))
  );
  directories.push(directory);
  return { directory };
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function observedFixture() {
  const fixture = store();
  const repoPath = join(fixture.directory, "repo");
  mkdirSync(repoPath);
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
  };
  git("init", "-q");
  writeFileSync(
    join(repoPath, ".branchbase.json"),
    JSON.stringify({
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        service: {
          instances: { mode: "selectable" },
          start: { argv: ["true"] },
          stop: "process",
          apps: { api: { protocol: "http", readiness: "tcp" } },
        },
      },
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
  const runtime = join(fixture.directory, "runtime");
  const state = new FileBranchBaseStateStore(join(runtime, "state.json"));
  const controller = new WorkspaceController(undefined, {
    processes: new ProcessSupervisor(runtime),
    state,
  });
  return {
    ...fixture,
    controller,
    state,
    repoPath,
    snapshot: controller.inspect(repoPath),
  };
}

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
      { repoPath, instanceId },
      {
        apps: {},
        createdAt: new Date().toISOString(),
        groupId: "service",
        instanceId,
        instanceIdsByGroup: { service: instanceId },
        worktreePath: repoPath,
        stop: "process",
      }
    );
    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    expect(state.run({ repoPath, instanceId })).not.toBeNull();
    expect(controller.inspect(repoPath).trusted).toBe(true);
  } finally {
    await controller.close();
  }
});

test("trust revocation blocks pending work on a persisted undiscovered worktree", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  try {
    controller.trustRepository(repoPath, [
      { fingerprint: snapshot.trustFingerprint },
    ]);
    const persistedWorktreePath = join(repoPath, "persisted-worktree");
    mkdirSync(persistedWorktreePath);
    const config = loadBranchBaseConfig(join(repoPath, ".branchbase.json"));
    config.appGroups.service.start = {
      argv: ["bun", "-e", "setTimeout(() => {}, 5000)"],
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
    const appGroups = (
      controller as unknown as {
        appGroups: { start: (target: AppGroupTarget) => Promise<unknown> };
      }
    ).appGroups;
    const pending = appGroups.start({
      config,
      groupId: "service",
      repoPath,
      worktree: {
        id: "persisted-worktree",
        path: persistedWorktreePath,
        routeLabel: "persisted-worktree",
      },
    });

    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    await pending.catch(() => undefined);
    expect(controller.inspect(repoPath).trusted).toBe(true);
    expect(
      snapshot.worktrees.some(({ path }) => path === persistedWorktreePath)
    ).toBe(false);
  } finally {
    await controller.close();
  }
});

test("trust revocation blocks a setup process for a persisted worktree", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  try {
    controller.trustRepository(repoPath, [
      { fingerprint: snapshot.trustFingerprint },
    ]);
    const worktreePath = join(repoPath, "removed-setup-worktree");
    mkdirSync(worktreePath);
    const worktreeId = Buffer.from(worktreePath).toString("base64url");
    const config = loadBranchBaseConfig(join(repoPath, ".branchbase.json"));
    state.instance({
      configFingerprint: repositoryCommandFingerprint(config),
      groupId: "service",
      mode: "per-worktree",
      repoLabel: "repo",
      repoPath,
      worktreeLabel: "removed-setup-worktree",
      worktreePath,
    });
    const processes = (
      controller as unknown as { processes: ProcessSupervisor }
    ).processes;
    const processId = setupProcessId(worktreeId);
    const pid = processes.startManagedProcess({
      argv: ["bun", "-e", "setTimeout(() => {}, 5000)"],
      cwd: worktreePath,
      env: process.env as Record<string, string>,
      label: "Setup",
      ownerId: worktreeId,
      ownerRoot: worktreePath,
      processId,
    });
    let managed = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (processes.managedPid(processId, worktreePath) === pid) {
        managed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(managed).toBe(true);
    expect(() => controller.revokeTrust(repoPath)).toThrow(
      "finish setup processes"
    );
  } finally {
    await controller.close();
  }
});

test("initializing a repository does not approve commands", async () => {
  const { controller, repoPath } = observedFixture();
  try {
    rmSync(join(repoPath, ".branchbase.json"));
    controller.initializeRepository(repoPath);
    expect(controller.inspect(repoPath).trusted).toBe(false);
  } finally {
    await controller.close();
  }
});
