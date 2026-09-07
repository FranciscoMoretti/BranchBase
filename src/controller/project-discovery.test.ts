import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawn } from "bun";

import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import {
  type DetectedService,
  type Observation,
  ObservationSchema,
} from "./discovery-contract";
import { scanRepositories } from "./folder-discovery";
import { ProductStore } from "./product-store";
import { ProjectDiscovery } from "./project-discovery";
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
  symlinkSync(root, join(root, "selected-alias"));
  expect(scanRepositories(root).repositories).toEqual([repo]);
  expect(scanRepositories(join(root, "selected-alias")).repositories).toEqual([
    repo,
  ]);
  expect(scanRepositories(root, 3, 1).warning).toContain("limited");
});
test("canonicalizes a selected symlink alias before scanning", async () => {
  const root = temporary();
  const selected = join(root, "selected");
  const alias = join(root, "alias");
  mkdirSync(selected);
  repository(join(selected, "app"));
  symlinkSync(selected, alias);
  const workspace = controller(join(root, "state"));
  try {
    workspace.addDevelopmentFolder(alias);
    expect(workspace.developmentFolders().map((folder) => folder.path)).toEqual(
      [realpathSync(selected)]
    );
    expect(workspace.projects().map((project) => project.path)).toEqual([
      realpathSync(join(selected, "app")),
    ]);
  } finally {
    await workspace.close();
  }
});
test("validates missing development folders with an actionable error", async () => {
  const root = temporary();
  const workspace = controller(join(root, "state"));
  try {
    expect(() => workspace.addDevelopmentFolder(join(root, "missing"))).toThrow(
      "Choose a development folder."
    );
  } finally {
    await workspace.close();
  }
});
test("removes missing development folders by their stored path", async () => {
  const root = temporary();
  const missing = join(root, "missing");
  const workspace = controller(join(root, "state"));
  try {
    new ProductStore(join(root, "state")).saveFolder(missing);
    workspace.removeDevelopmentFolder(missing);
    expect(workspace.developmentFolders()).toEqual([]);
  } finally {
    await workspace.close();
  }
});
test("preserves unreadable-folder and scan-limit warnings together", () => {
  const root = temporary();
  const unreadable = join(root, "aaa-unreadable");
  mkdirSync(unreadable);
  mkdirSync(join(root, "bbb-queued"));
  const originalMode = 0o755;
  chmodSync(unreadable, 0o000);
  try {
    try {
      readdirSync(unreadable);
      return;
    } catch {
      // The environment enforces the permission bits, so exercise the warning.
    }
    const result = scanRepositories(root, 2, 2);
    expect(result.warning).toContain("folders could not be read");
    expect(result.warning).toContain("Scan limited to 2 folders");
  } finally {
    chmodSync(unreadable, originalMode);
  }
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
test("associated services exclude managed, nested, and unrelated paths", () => {
  const root = temporary();
  const repo = repository(join(root, "app"));
  const nested = repository(join(repo, "nested"));
  const inside = join(repo, "packages", "web");
  mkdirSync(inside, { recursive: true });
  const store = new ProductStore(join(root, "state"));
  const service = (cwd: string, pid: number): DetectedService => ({
    cwd,
    pid,
    port: pid,
    command: "bun",
    address: `127.0.0.1:${pid}`,
    startedAt: null,
    url: null,
    resources: null,
    managed: false,
  });
  let services = [
    service(inside, 1001),
    { ...service(inside, 1004), managed: true },
    service(nested, 1002),
    service(`${repo}-other`, 1003),
  ];
  const probed: number[] = [];
  let warning: string | null = null;
  const discovery = new ProjectDiscovery(
    store,
    () => [{ id: "main", path: repo, branch: "main" }],
    (path) => git(path, "rev-parse", "--show-toplevel"),
    () => [],
    {
      inspect: () => ({ at: Date.now(), services, warning }),
      webUrl: (item) => {
        probed.push(item.pid);
        return null;
      },
    }
  );
  expect(
    discovery.observe(repo).worktrees[0]?.services.map((item) => item.pid)
  ).toEqual([1001]);
  expect(probed).toEqual([1001]);
  expect(store.events()).toEqual([]);
  services = [];
  warning = "Inspection unavailable";
  discovery.observe(repo);
  expect(store.events()).toEqual([]);
  warning = null;
  discovery.observe(repo);
  expect(store.events()[0]?.worktreeId).toBe("main");
  expect(store.events()[0]?.worktreeName).toBe("main");
  expect(store.events()[0]?.message).toContain(
    "No longer detected: main · bun on port 1001"
  );
});
test("observation starts with a baseline and deduplicates unchanged worktrees", () => {
  const root = temporary();
  const store = new ProductStore(root);
  const observation: Observation = {
    repoPath: "/repo",
    configured: false,
    updatedAt: new Date().toISOString(),
    warning: null,
    worktrees: [
      { id: "w", path: "/repo", branch: "main", isMain: true, services: [] },
    ],
  };
  store.observeDetected(observation);
  store.observeDetected(observation);
  expect(store.events()).toEqual([]);
  store.observeDetected({ ...observation, worktrees: [] });
  expect(store.events()).toHaveLength(1);
});
test("observation schema bounds service identities and resources", () => {
  const observation = {
    configured: false,
    repoPath: "/repo",
    updatedAt: "2026-01-01T00:00:00.000Z",
    warning: null,
    worktrees: [
      {
        id: "main",
        path: "/repo",
        branch: "main",
        isMain: true,
        services: [
          {
            pid: 123,
            port: 3000,
            command: "server",
            cwd: "/repo",
            startedAt: null,
            url: null,
            address: "127.0.0.1:3000",
            resources: { cpuPercent: 1, memoryBytes: 1024, processCount: 1 },
            managed: false,
          },
        ],
      },
    ],
  };
  expect(ObservationSchema.safeParse(observation).success).toBe(true);
  expect(
    ObservationSchema.safeParse({
      ...observation,
      worktrees: [
        {
          ...observation.worktrees[0],
          services: [{ ...observation.worktrees[0].services[0], pid: 0 }],
        },
      ],
    }).success
  ).toBe(false);
  expect(
    ObservationSchema.safeParse({
      ...observation,
      worktrees: [
        {
          ...observation.worktrees[0],
          services: [
            {
              ...observation.worktrees[0].services[0],
              resources: { cpuPercent: 1, memoryBytes: -1, processCount: 1 },
            },
          ],
        },
      ],
    }).success
  ).toBe(false);
});
test("version one metadata loads with no discovery fields", () => {
  const root = temporary();
  writeFileSync(
    join(root, "product.json"),
    JSON.stringify({ events: [], observations: {}, projects: [], version: 1 })
  );
  const store = new ProductStore(root);
  expect(store.folders()).toEqual([]);
  expect(store.excludedPaths()).toEqual([]);
});

(process.platform === "darwin" ? test : test.skip)(
  "a real listener in an external linked worktree is associated and its process usage is observed",
  async () => {
    const root = temporary();
    const repo = repository(join(root, "app"));
    const linked = join(root, "external");
    git(repo, "worktree", "add", "-qb", "feature", linked);
    const child = spawn(
      [
        process.execPath,
        "-e",
        "const server = Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response('test')}); console.log(server.port);",
      ],
      { cwd: linked, stdout: "pipe", stderr: "pipe" }
    );
    const workspace = controller(join(root, "state"));
    try {
      const line = await child.stdout.getReader().read();
      const port = Number(new TextDecoder().decode(line.value).trim());
      expect(port).toBeGreaterThan(0);
      let first = workspace.observeRepository(repo);
      let service = first.worktrees
        .find((item) => item.path === linked)
        ?.services.find((item) => item.pid === child.pid);
      expect(service?.port).toBe(port);
      expect(service?.managed).toBe(false);
      const resourceDeadline = Date.now() + 1500;
      while (
        (service?.resources?.processCount ?? 0) === 0 &&
        Date.now() < resourceDeadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        first = workspace.observeRepository(repo);
        service = first.worktrees
          .find((item) => item.path === linked)
          ?.services.find((item) => item.pid === child.pid);
      }
      expect(service?.resources?.processCount).toBeGreaterThan(0);
      expect(first.worktrees[0]?.services).toEqual([]);
      const expectedUrl = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 2000;
      let next = workspace.observeRepository(repo);
      while (Date.now() < deadline) {
        const url = next.worktrees
          .find((item) => item.path === linked)
          ?.services.find((item) => item.pid === child.pid)?.url;
        if (url === expectedUrl) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        next = workspace.observeRepository(repo);
      }
      expect(
        next.worktrees
          .find((item) => item.path === linked)
          ?.services.find((item) => item.pid === child.pid)?.url
      ).toBe(expectedUrl);
    } finally {
      child.kill();
      await child.exited;
      await workspace.close();
    }
  },
  10_000
);
