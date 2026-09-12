import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { ProcessSupervisor } from "../adapters/host/process-supervisor";
import { FileBranchBaseStateStore } from "../app-group/assignments";
import { WorkspaceController } from "../application/workspace-controller";
import { ProductCatalogError, ProductStore } from "./catalog";

const directories: string[] = [];
const store = () => {
  const directory = realpathSync(
    mkdtempSync(pathModule.join(tmpdir(), "branchbase-product-"))
  );
  directories.push(directory);
  return { directory, product: new ProductStore(directory) };
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});
test("project metadata and pins survive restart without authorizing commands", () => {
  const { directory, product } = store();
  product.saveProject("/repo", "App", [
    { appId: "a", groupId: "g", worktreeId: "w" },
  ]);
  product.saveProject("/repo", "Renamed");
  expect(new ProductStore(directory).projects()).toEqual([
    {
      addedAt: expect.any(String),
      name: "Renamed",
      path: "/repo",
      pins: [{ appId: "a", groupId: "g", worktreeId: "w" }],
    },
  ]);
});
test("removal preserves operational history", () => {
  const { product } = store();
  product.saveProject("/repo", "App");
  product.append({
    kind: "command",
    message: "Start completed",
    repoPath: "/repo",
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

test("addedAt must be an ISO timestamp", () => {
  const { directory, product } = store();
  writeFileSync(
    pathModule.join(directory, "product.json"),
    JSON.stringify({
      projects: [
        { addedAt: "2026-09-06", name: "App", path: "/repo", pins: [] },
      ],
      version: 1,
    })
  );

  expect(() => product.projects()).toThrow(ProductCatalogError);
});

test("invalid project catalogs fail with recovery guidance without overwriting the file", () => {
  const { directory, product } = store();
  const contents = '{"projects": [}';
  writeFileSync(pathModule.join(directory, "product.json"), contents);

  expect(() => product.projects()).toThrow(ProductCatalogError);
  expect(() => product.projects()).toThrow("repair or restore it");
  expect(() => product.saveProject("/repo", "App")).toThrow(
    ProductCatalogError
  );
  expect(
    readFileSync(pathModule.join(directory, "product.json"), "utf-8")
  ).toBe(contents);
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
          category: "infrastructure",
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

test("observed shared runtime transitions are durable, deduplicated, and include route failures", async () => {
  const { product, directory, snapshot, controller } = observedFixture();
  try {
    const [worktree] = snapshot.worktrees;
    snapshot.worktrees.push({
      ...structuredClone(worktree),
      branch: "second",
      id: "second",
    });
    product.observe(snapshot);
    expect(product.events()).toHaveLength(0);
    for (const item of snapshot.worktrees) {
      const [group] = item.appGroups;
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
    await controller.execute("save-project", { name: "My project", repoPath });
    expect(controller.projects()[0]).toMatchObject({
      name: "My project",
      path: repoPath,
    });
    writeFileSync(pathModule.join(repoPath, ".branchbase.json"), "invalid");
    expect(controller.projects()[0].workspace).toBeNull();
    controller.removeProject(repoPath);
    expect(controller.projects()).toHaveLength(0);
    expect(
      new ProductStore(pathModule.join(directory, "runtime"))
        .events(repoPath)
        .some((event) => event.message === "Project saved")
    ).toBe(true);
  } finally {
    await controller.close();
  }
});

test("saved projects can be removed through a symlink alias", async () => {
  const { controller, repoPath, directory } = observedFixture();
  const alias = pathModule.join(directory, "repo-alias");
  symlinkSync(repoPath, alias, "dir");
  try {
    controller.saveProject(repoPath);
    controller.removeProject(alias);
    expect(controller.projects()).toHaveLength(0);
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
    expect(() => controller.removeProject(repoPath)).toThrow("Retained runs");
    expect(() => controller.revokeTrust(repoPath)).toThrow("Stop App groups");
    expect(controller.projects()).toHaveLength(1);
    expect(state.run({ instanceId, repoPath })).not.toBeNull();
  } finally {
    await controller.close();
  }
});

test("activity history initializes when upgrading a project-only catalog", () => {
  const { directory, product } = store();
  writeFileSync(
    pathModule.join(directory, "product.json"),
    JSON.stringify({
      projects: [
        {
          addedAt: "2026-09-06T00:00:00.000Z",
          name: "App",
          path: "/repo",
          pins: [],
        },
      ],
      version: 1,
    })
  );
  expect(product.events()).toEqual([]);
  product.append({
    kind: "command",
    message: "Saved",
    repoPath: "/repo",
    severity: "success",
  });
  expect(product.projects()[0]?.name).toBe("App");
  expect(new ProductStore(directory).events()).toHaveLength(1);
});
