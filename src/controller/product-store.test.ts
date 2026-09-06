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
import { join } from "node:path";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { ProductCatalogError, ProductStore } from "./product-store";
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
test("pin limits reject invalid metadata without losing the prior record", () => {
  const { product } = store();
  product.saveProject("/repo", "App");
  expect(() => product.saveProject("/repo", " ")).toThrow();
  expect(product.projects()[0]?.name).toBe("App");
});

test("addedAt must be an ISO timestamp", () => {
  const { directory, product } = store();
  writeFileSync(
    join(directory, "product.json"),
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
  writeFileSync(join(directory, "product.json"), contents);

  expect(() => product.projects()).toThrow(ProductCatalogError);
  expect(() => product.projects()).toThrow("repair or restore it");
  expect(() => product.saveProject("/repo", "App")).toThrow(
    ProductCatalogError
  );
  expect(readFileSync(join(directory, "product.json"), "utf8")).toBe(contents);
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

test("saved projects survive controller restart and unavailable configuration can be removed safely", async () => {
  const { controller, repoPath } = observedFixture();
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
  } finally {
    await controller.close();
  }
});

test("saved projects can be removed through a symlink alias", async () => {
  const { controller, repoPath, directory } = observedFixture();
  const alias = join(directory, "repo-alias");
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
