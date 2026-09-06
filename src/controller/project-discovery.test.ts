import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { scanRepositories } from "./folder-discovery";
import { ProductStore } from "./product-store";
import { WorkspaceController } from "./workspace-controller";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) {
    close();
  }
});
function temporary() {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), "branchbase-discovery-"))
  );
  cleanup.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function git(path: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: path, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}
function repository(path: string) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  git(
    path,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "--allow-empty",
    "-qm",
    "Initial"
  );
  return path;
}
function controller(directory: string) {
  return new WorkspaceController(undefined, {
    state: new FileBranchBaseStateStore(join(directory, "state.json")),
    processes: new ProcessSupervisor(join(directory, "control")),
  });
}
test("folder scans are bounded and skip symlinks, dependencies and repository contents", () => {
  const root = temporary();
  const repo = repository(join(root, "team", "app"));
  repository(join(repo, "nested"));
  repository(join(root, "node_modules", "ignored"));
  repository(join(root, "a", "b", "c", "too-deep"));
  symlinkSync(repo, join(root, "linked"));
  expect(scanRepositories(root).repositories).toEqual([repo]);
  expect(scanRepositories(root, 3, 1).warning).toContain("limited");
});
test("watch folders persist, deduplicate linked worktrees and respect manual removal", async () => {
  const root = temporary();
  const code = join(root, "Code");
  const repo = repository(join(code, "app"));
  const linked = join(root, "external-checkout");
  git(repo, "worktree", "add", "-qb", "feature", linked);
  // A second scan root containing a linked checkout still resolves the same project.
  const workspace = controller(join(root, "state"));
  try {
    workspace.addDevelopmentFolder(code);
    workspace.addDevelopmentFolder(linked);
    expect(workspace.projects()).toHaveLength(1);
    const observation = workspace.observeRepository(linked);
    expect(observation.repoPath).toBe(repo);
    expect(observation.configured).toBe(false);
    expect(observation.worktrees.map((item) => item.path)).toEqual([
      repo,
      linked,
    ]);
    expect(workspace.projects()[0]?.error).toBeNull();
    expect(existsSync(join(repo, ".branchbase.json"))).toBe(false);
    workspace.saveProject(repo, "My project");
    workspace.scanDevelopmentFolders();
    expect(workspace.projects()[0]?.name).toBe("My project");
    workspace.removeProject(repo);
    workspace.scanDevelopmentFolders();
    expect(workspace.projects()).toEqual([]);
    workspace.saveProject(repo);
    workspace.removeDevelopmentFolder(code);
    expect(workspace.projects()).toHaveLength(1);
    expect(
      new ProductStore(join(root, "state")).folders().map((item) => item.path)
    ).toEqual([linked]);
    rmSync(linked, { recursive: true, force: true });
    workspace.scanDevelopmentFolders();
    expect(workspace.developmentFolders()[0]?.warning).toContain("unavailable");
  } finally {
    await workspace.close();
  }
});
test("configuring an observed project does not approve or execute its commands", async () => {
  const root = temporary();
  const repo = repository(join(root, "app"));
  const workspace = controller(join(root, "state"));
  try {
    workspace.saveProject(repo);
    expect(workspace.observeRepository(repo).configured).toBe(false);
    workspace.initializeRepository(repo);
    expect(workspace.observeRepository(repo).configured).toBe(true);
    const snapshot = workspace.inspect(repo);
    expect(snapshot.trusted).toBe(false);
    expect(snapshot.globalRunningCount).toBe(0);
    expect(
      existsSync(join(root, "state", "control", "trusted-repositories.json"))
    ).toBe(false);
  } finally {
    await workspace.close();
  }
});
test("version one metadata loads with no discovery fields", () => {
  const root = temporary();
  writeFileSync(
    join(root, "product.json"),
    JSON.stringify({ projects: [], version: 1 })
  );
  const store = new ProductStore(root);
  expect(store.folders()).toEqual([]);
  expect(store.excludedPaths()).toEqual([]);
});
