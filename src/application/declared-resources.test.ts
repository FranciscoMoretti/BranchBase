import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProcessSupervisor } from "../adapters/host/process-supervisor";
import { FileBranchBaseStateStore } from "../app-group/assignments";
import { WorkspaceController } from "./workspace-controller";

const git = (directory: string, ...args: string[]) => {
  const result = spawnSync("git", args, {
    cwd: directory,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
};

const fixture = () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "declared-resources-"))
  );
  const repo = path.join(root, "project");
  mkdirSync(path.join(repo, "infra"), { recursive: true });
  git(repo, "init", "-qb", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.test");
  const config = {
    appGroups: {
      web: { apps: {}, start: { argv: ["true"] }, stop: "process" },
    },
    managedResources: { database: { file: "infra/database.json" } },
    setup: { argv: ["true"] },
    version: 1,
  };
  const definition = {
    directory: ".",
    files: [],
    id: "database",
    idle: "keep-running",
    instances: { shared: { outputs: { database: "development" }, ports: {} } },
    name: "Project database",
    recipe: { apps: {}, start: { argv: ["true"] }, stop: "process" },
    version: 1,
  };
  const file = path.join(repo, "infra/database.json");
  writeFileSync(file, JSON.stringify(definition));
  writeFileSync(path.join(repo, ".branchbase.json"), JSON.stringify(config));
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Fixture");
  const state = new FileBranchBaseStateStore(
    path.join(root, "control/state.json")
  );
  const controller = new WorkspaceController(undefined, {
    processes: new ProcessSupervisor(path.join(root, "control")),
    routing: {
      activate: async () => {},
      deactivate: async () => {},
      observe: () => "inactive",
      url: (host) => `http://${host}`,
    },
    state,
  });
  return { config, controller, definition, file, git, repo, root, state };
};

test("repository declarations are discovered from the primary checkout without approval or startup", async () => {
  const f = fixture();
  try {
    const branch = path.join(f.root, "checkout");
    f.git(f.repo, "worktree", "add", "-qb", "feature", branch);
    const snapshot = f.controller.inspect(branch);
    expect(snapshot.managedResources).toHaveLength(1);
    expect(snapshot.managedResources?.[0]).toMatchObject({
      approved: false,
      id: "database",
      instances: ["shared"],
      path: f.file,
    });
    expect(
      f.state
        .allResourceInstances()
        .every(({ instance }) => instance.run === null)
    ).toBe(true);
    await expect(
      f.controller.operateManagedResource("database", "shared", "start")
    ).rejects.toThrow("approve resource");
    const registry = path.join(f.root, "control/managed-resources.json");
    const before = readFileSync(registry, "utf-8");
    f.controller.inspect(branch);
    expect(readFileSync(registry, "utf-8")).toBe(before);
    const { managedResources: _declarations, ...consumerConfig } = f.config;
    writeFileSync(
      path.join(f.repo, ".branchbase.json"),
      JSON.stringify(consumerConfig)
    );
    expect(f.controller.inspect(f.repo).managedResources?.[0].id).toBe(
      "database"
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

test("another clone cannot silently replace a declared resource owner", () => {
  const f = fixture();
  try {
    f.controller.inspect(f.repo);
    const clone = path.join(f.root, "clone");
    f.git(f.root, "clone", "-q", f.repo, clone);
    expect(() => f.controller.inspect(clone)).toThrow("authoritative owner");
    expect(f.controller.inspect(f.repo).managedResources?.[0].path).toBe(
      f.file
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});

test("invalid declarations report their path without registering a different resource", () => {
  const f = fixture();
  try {
    writeFileSync(f.file, JSON.stringify({ ...f.definition, id: "different" }));
    expect(() => f.controller.inspect(f.repo)).toThrow(
      "does not match definition ID"
    );
    writeFileSync(f.file, "not json");
    expect(() => f.controller.inspect(f.repo)).toThrow("infra/database.json");
    rmSync(f.file);
    expect(() => f.controller.inspect(f.repo)).toThrow(
      "Cannot load declared resource"
    );
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
});
