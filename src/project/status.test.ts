import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { inspectListeningPorts } from "../adapters/host/ports";
import type { AppGroupInstance } from "../app-group/assignments";
import type { StatusDependencies } from "./configured-status";
import type { Observation } from "./discovery-contract";
import { createProjectStatus, readProjectStatus } from "./status";

const worktrees = [
  { branch: "main", id: "main-id", isMain: true, path: "/tmp/project" },
];

const temporaryRepositories: string[] = [];
afterEach(() => {
  for (const directory of temporaryRepositories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Project status", () => {
  test("keeps Git facts when a Project is unconfigured", () => {
    const status = createProjectStatus({
      repoPath: "/tmp/project",
      workspace: null,
      worktrees,
    });

    expect(status.configuration).toEqual({
      error: null,
      state: "unconfigured",
    });
    expect(status.worktrees).toEqual(worktrees);
    expect(status.workspace).toBeNull();
  });

  test("keeps Git facts and reports configuration errors", () => {
    const status = createProjectStatus({
      configurationError: "Invalid JSON",
      repoPath: "/tmp/project",
      workspace: null,
      worktrees,
    });

    expect(status.configuration).toEqual({
      error: "Invalid JSON",
      state: "invalid",
    });
    expect(status.worktrees).toEqual(worktrees);
  });

  const repository = (config?: string): string => {
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "branchbase-status-"))
    );
    temporaryRepositories.push(root);
    spawnSync("git", ["init", "-q", root]);
    if (config !== undefined) {
      writeFileSync(path.join(root, ".branchbase.json"), config);
    }
    return root;
  };

  // eslint-disable-next-line unicorn/consistent-function-scoping
  const dependencies = (
    observe: (root: string) => Observation
  ): StatusDependencies & {
    inspectPorts?: typeof inspectListeningPorts;
    observe: (root: string) => Observation;
  } => ({
    appGroups: {
      inspect: () => {
        throw new Error("not expected for this test");
      },
      inspectDetached: () => {
        throw new Error("not expected for this test");
      },
    },
    observe,
    processes: {
      controlDirectory: "/tmp/control",
      listManagedProcesses: () => [],
      managedFailure: () => null,
      managedPid: () => null,
    },
    state: {
      hasRunForWorktree: () => false,
      runningInstancesForWorktree: (): AppGroupInstance[] => [],
      worktreeConfigSource: () => "project-default" as const,
    },
  });

  test("retains worktrees when the Project is unconfigured", () => {
    const root = repository();
    const status = readProjectStatus(
      root,
      dependencies((_root): Observation => {
        throw new Error("host unavailable");
      })
    );

    expect(status.configuration.state).toBe("unconfigured");
    expect(status.worktrees).toHaveLength(1);
    expect(status.issues.some((issue) => issue.area === "observation")).toBe(
      true
    );
  });

  test("retains worktrees when the Project configuration is invalid", () => {
    const root = repository("{");
    const status = readProjectStatus(
      root,
      dependencies((_root): Observation => {
        throw new Error("host unavailable");
      })
    );

    expect(status.configuration.state).toBe("invalid");
    expect(status.configuration.error).toContain("Expected '}'");
    expect(status.worktrees).toHaveLength(1);
  });

  test("repeated reads do not invoke identity or activity writes", () => {
    const root = repository();
    let reads = 0;
    const deps = dependencies(() => {
      reads += 1;
      return {
        configured: false,
        repoPath: root,
        resources: null,
        updatedAt: new Date().toISOString(),
        warning: null,
        worktrees: [],
      };
    });

    readProjectStatus(root, deps);
    readProjectStatus(root, deps);

    expect(reads).toBe(2);
  });

  test("retains cleanup targets when host port observation is unavailable", () => {
    const root = repository();
    const instance = {
      configFingerprint: "fingerprint",
      endpoints: {},
      groupId: "web",
      id: "instance-1",
      isDefault: true,
      mode: "per-worktree" as const,
      name: "Web",
      routeLabel: "web",
      run: null,
      worktreePath: root,
    };
    const deps = dependencies((_root): Observation => {
      throw new Error("host unavailable");
    });
    deps.state.runningInstancesForWorktree = () => [instance];
    deps.inspectPorts = () => {
      throw new Error("ports unavailable");
    };

    const status = readProjectStatus(root, deps);

    expect(status.retainedCleanupTargets).toEqual([
      {
        groupId: "web",
        instanceId: "instance-1",
        name: "Web",
        worktreePath: root,
      },
    ]);
    expect(status.issues.some((issue) => issue.area === "runtime")).toBe(true);
  });

  test("does not inspect ports when there are no retained cleanup runs", () => {
    const root = repository();
    let inspected = false;
    const deps = dependencies((_root): Observation => {
      throw new Error("host unavailable");
    });
    deps.inspectPorts = () => {
      inspected = true;
      throw new Error("should not be called");
    };

    const status = readProjectStatus(root, deps);

    expect(inspected).toBe(false);
    expect(status.retainedCleanupTargets).toEqual([]);
  });
});
