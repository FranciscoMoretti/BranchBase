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
import { ProcessSupervisor } from "../runtime/process-supervisor";
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

test("trust revocation blocks pending work on a persisted removed worktree", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  try {
    controller.trustRepository(repoPath, [
      { fingerprint: snapshot.trustFingerprint },
    ]);
    const removedWorktreePath = join(repoPath, "removed-worktree");
    const config = loadBranchBaseConfig(join(repoPath, ".branchbase.json"));
    state.instance({
      configFingerprint: repositoryCommandFingerprint(config),
      groupId: "service",
      mode: "per-worktree",
      repoLabel: "repo",
      repoPath,
      worktreeLabel: "removed-worktree",
      worktreePath: removedWorktreePath,
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
        id: "removed-worktree",
        path: removedWorktreePath,
        routeLabel: "removed-worktree",
      },
    });

    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    await pending.catch(() => undefined);
    expect(controller.inspect(repoPath).trusted).toBe(true);
    expect(
      snapshot.worktrees.some(({ path }) => path === removedWorktreePath)
    ).toBe(false);
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
