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
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { ProductStore } from "./product-store";
import { WorkspaceController } from "./workspace-controller";

const directories: string[] = [];
function store() {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "branchbase-product-"))
  );
  directories.push(directory);
  return { directory, product: new ProductStore(directory) };
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("project metadata and pins survive restart without authorizing commands", () => {
  const { directory, product } = store();
  product.saveProject("/repo", "App", [
    { worktreeId: "w", groupId: "g", appId: "a" },
  ]);
  product.saveProject("/repo", "Renamed");
  expect(new ProductStore(directory).projects()).toEqual([
    {
      addedAt: expect.any(String),
      name: "Renamed",
      path: "/repo",
      pins: [{ worktreeId: "w", groupId: "g", appId: "a" }],
    },
  ]);
});
test("removal preserves operational history", () => {
  const { product } = store();
  product.saveProject("/repo", "App");
  product.append({
    repoPath: "/repo",
    kind: "command",
    message: "Start completed",
    severity: "success",
  });
  product.removeProject("/repo");
  expect(product.projects()).toEqual([]);
  expect(product.events("/repo")).toHaveLength(1);
  expect(product.events("/another")).toHaveLength(0);
});
test("pin limits reject invalid metadata without losing the prior record", () => {
  const { product } = store();
  product.saveProject("/repo", "App");
  expect(() => product.saveProject("/repo", " ")).toThrow();
  expect(product.projects()[0]?.name).toBe("App");
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
          category: "infrastructure",
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

test("observed shared runtime transitions are durable, deduplicated, and include route failures", async () => {
  const { product, directory, snapshot, controller } = observedFixture();
  try {
    const worktree = snapshot.worktrees[0];
    snapshot.worktrees.push({
      ...structuredClone(worktree),
      id: "second",
      branch: "second",
    });
    product.observe(snapshot);
    expect(product.events()).toHaveLength(0);
    for (const item of snapshot.worktrees) {
      const group = item.appGroups[0];
      group.health = "running";
      group.processRunning = true;
      group.apps[0].readiness = "ready";
      group.apps[0].routeState = "active";
    }
    product.observe(snapshot);
    product.observe(snapshot);
    expect(product.events()).toHaveLength(1);
    expect(product.events()[0].message).toBe("service: Running");
    for (const item of snapshot.worktrees) {
      item.appGroups[0].apps[0].routeState = "conflict";
    }
    product.observe(snapshot);
    expect(new ProductStore(directory).events()[0]).toMatchObject({
      message: "service: Partial",
      severity: "warning",
    });
    snapshot.worktrees.pop();
    product.observe(snapshot);
    expect(product.events()[0]).toMatchObject({
      message: "Worktree no longer discovered",
      worktreeName: "second",
    });
  } finally {
    await controller.close();
  }
});

test("saved projects survive controller restart and unavailable configuration can be removed safely", async () => {
  const { controller, repoPath, directory } = observedFixture();
  try {
    await controller.execute("save-project", { repoPath, name: "My project" });
    expect(controller.projects()[0]).toMatchObject({
      name: "My project",
      path: repoPath,
    });
    writeFileSync(join(repoPath, ".branchbase.json"), "invalid");
    expect(controller.projects()[0].workspace).toBeNull();
    controller.removeProject(repoPath);
    expect(controller.projects()).toHaveLength(0);
    expect(
      new ProductStore(join(directory, "runtime"))
        .events(repoPath)
        .some((event) => event.message === "Project saved")
    ).toBe(true);
  } finally {
    await controller.close();
  }
});

test("project removal and trust revocation preserve retained runtime ownership", async () => {
  const { controller, state, repoPath, snapshot } = observedFixture();
  try {
    controller.saveProject(repoPath);
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
    expect(() => controller.removeProject(repoPath)).toThrow("Retained runs");
    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    expect(controller.projects()).toHaveLength(1);
    expect(state.run({ repoPath, instanceId })).not.toBeNull();
  } finally {
    await controller.close();
  }
});
