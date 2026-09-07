import { describe, expect, it } from "bun:test";
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

import { selectRequestedWorktrees } from "../commands/command";
import { loadBranchBaseConfig } from "../config/branchbase-config";
import { trustRepository as saveRepositoryTrust } from "../config/repository-trust";
import { parseWorktreeList } from "../git/discover-worktrees";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../runtime/local-routing";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { WorkspaceController } from "./workspace-controller";
import {
  appGroupCanRestart,
  appsCanRestart,
  worktreeHasRunningAppGroups,
} from "./workspace-snapshot";
import { commandWorkingDirectory } from "./worktree-command";

const CLEANUP_APP_GROUP = /^cleanup:/;

const fakeRoutingEngine = (): LocalRoutingEngine => ({
  activate: async (_route: LocalRoute) => undefined,
  deactivate: async (_route: LocalRoute) => undefined,
  observe: (_route: LocalRoute): LocalRouteState => "inactive",
  url: (hostname: string) => `http://${hostname}:1355`,
});

describe("slot-free workspace inspection", () => {
  it("projects stable endpoint identity without allocating a backing port", () => {
    const root = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-controller-")
    );
    const statePath = pathModule.join(root, ".local", "state.json");
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        pathModule.join(root, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["bun", "install"] },
          appGroups: {
            product: {
              name: "Product Apps",
              start: { argv: ["bun", "run", "dev"] },
              stop: { argv: ["bun", "run", "stop"] },
              env: { PORT: "{apps.web.port}" },
              apps: {
                web: { name: "Website", protocol: "http", readiness: "tcp" },
              },
            },
          },
        })
      );
      const controller = new WorkspaceController(undefined, {
        routing: fakeRoutingEngine(),
        state: new FileBranchBaseStateStore(statePath),
      });

      const snapshot = controller.inspect(root);
      expect(snapshot.projectDefaultPrimaryAppGroup).toBe("product");
      expect(snapshot.worktrees[0]?.appGroups[0]).toMatchObject({
        health: "not-running",
        id: "product",
        name: "Product Apps",
        processRunning: false,
        stop: "command",
      });
      expect(snapshot.worktrees[0]?.appGroups[0]?.apps[0]).toEqual({
        directUrl: null,
        id: "web",
        label: "Website",
        listening: false,
        open: false,
        ownership: "none",
        port: null,
        protocol: "http",
        readiness: "waiting",
        routeState: "inactive",
        url: null,
      });
      expect(snapshot.trustCommands).toHaveLength(3);
      expect(readFileSync(statePath, "utf-8")).toContain(
        `website.${snapshot.worktrees[0]?.branch}.branchbase-controller-`
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("lets one worktree use its own configuration without changing the Project default", async () => {
    const sandbox = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-config-source-")
    );
    const root = pathModule.join(sandbox, "chat-js");
    const experiment = pathModule.join(sandbox, "chat-js-experiment");
    const statePath = pathModule.join(sandbox, ".local", "state.json");
    const controlDirectory = pathModule.join(sandbox, ".control");
    const config = (groupId: string, startCommand = "true") => ({
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        [groupId]: {
          start: { argv: [startCommand] },
          stop: "process",
          apps: {
            web: { protocol: "http", readiness: "tcp" },
          },
        },
      },
    });
    try {
      mkdirSync(root);
      spawnSync("git", ["init", "-q"], { cwd: root });
      spawnSync("git", ["config", "user.email", "branchbase@example.com"], {
        cwd: root,
      });
      spawnSync("git", ["config", "user.name", "BranchBase Test"], {
        cwd: root,
      });
      writeFileSync(
        pathModule.join(root, ".branchbase.json"),
        JSON.stringify(config("default-apps"))
      );
      spawnSync("git", ["add", ".branchbase.json"], { cwd: root });
      spawnSync("git", ["commit", "-qm", "Add BranchBase config"], {
        cwd: root,
      });
      spawnSync(
        "git",
        ["worktree", "add", "-q", "-b", "experiment", experiment],
        { cwd: root }
      );
      writeFileSync(
        pathModule.join(experiment, ".branchbase.json"),
        JSON.stringify(config("experiment-apps"))
      );
      const state = new FileBranchBaseStateStore(statePath);
      const controller = new WorkspaceController(undefined, {
        processes: new ProcessSupervisor(controlDirectory),
        routing: fakeRoutingEngine(),
        state,
      });

      const inherited = controller.inspect(experiment);
      const experimentWorktree = inherited.worktrees.find(
        ({ path }) => path === realpathSync(experiment)
      );
      expect(inherited.repoPath).toBe(realpathSync(root));
      expect(experimentWorktree).toMatchObject({
        configuration: {
          path: pathModule.join(realpathSync(root), ".branchbase.json"),
          preference: "project-default",
          source: "project-default",
        },
        primaryAppGroup: "default-apps",
      });

      await controller.execute("select-worktree-config-source", {
        repoPath: experiment,
        source: "checkout",
        worktreeId: experimentWorktree?.id,
      });
      const reviewedExperiment = controller
        .inspect(root)
        .worktrees.find(({ path }) => path === realpathSync(experiment));
      if (!reviewedExperiment) {
        throw new Error("Expected the experiment worktree");
      }
      const experimentApproval = {
        fingerprint: reviewedExperiment.configuration.trustFingerprint,
        worktreeId: reviewedExperiment.id,
      };
      writeFileSync(
        pathModule.join(experiment, ".branchbase.json"),
        JSON.stringify(config("experiment-apps", "printf"))
      );
      expect(() =>
        controller.trustRepository(root, [experimentApproval])
      ).toThrow("commands changed after they were reviewed");
      writeFileSync(
        pathModule.join(experiment, ".branchbase.json"),
        JSON.stringify(config("experiment-apps"))
      );
      controller.trustRepository(root, [experimentApproval]);
      const experimentOnlyTrust = controller.inspect(root);
      expect(experimentOnlyTrust.trusted).toBe(false);
      expect(
        experimentOnlyTrust.worktrees.find(
          ({ path }) => path === realpathSync(experiment)
        )?.configuration.trusted
      ).toBe(true);
      writeFileSync(
        pathModule.join(experiment, ".branchbase.json"),
        JSON.stringify(config("experiment-apps", "printf"))
      );
      saveRepositoryTrust(
        realpathSync(root),
        loadBranchBaseConfig(pathModule.join(root, ".branchbase.json")),
        controlDirectory
      );

      const selected = controller.inspect(root);
      const selectedExperiment = selected.worktrees.find(
        ({ path }) => path === realpathSync(experiment)
      );
      expect(selectedExperiment).toMatchObject({
        configuration: {
          path: pathModule.join(realpathSync(experiment), ".branchbase.json"),
          preference: "checkout",
          source: "checkout",
        },
        primaryAppGroup: "experiment-apps",
      });
      expect(selectedExperiment?.appGroups.map(({ id }) => id)).toEqual([
        "experiment-apps",
      ]);
      const selectedMain = selected.worktrees.find(
        ({ path }) => path === realpathSync(root)
      );
      expect(selectedMain).toMatchObject({
        configuration: {
          preference: "project-default",
          source: "project-default",
          trusted: true,
        },
        primaryAppGroup: "default-apps",
      });
      expect(selected.trusted).toBe(true);
      expect(selectedExperiment?.configuration.trusted).toBe(false);
      expect(() =>
        controller.assertTrusted(selected.repoPath, selectedMain?.id)
      ).not.toThrow();
      expect(() =>
        controller.assertTrusted(selected.repoPath, selectedExperiment?.id)
      ).toThrow("Review and trust");

      const selectedMainGroup = selectedMain?.appGroups[0];
      if (!(selectedMain && selectedMainGroup)) {
        throw new Error("Expected the main worktree App group");
      }
      state.saveRun(
        {
          instanceId: selectedMainGroup.instance.id,
          repoPath: selected.repoPath,
        },
        {
          apps: {},
          createdAt: new Date().toISOString(),
          groupId: selectedMainGroup.id,
          instanceId: selectedMainGroup.instance.id,
          instanceIdsByGroup: {
            [selectedMainGroup.id]: selectedMainGroup.instance.id,
          },
          worktreePath: selectedMain.path,
        }
      );

      const activeMain = controller.inspect(root);
      expect(
        activeMain.worktrees.find(({ path }) => path === realpathSync(root))
          ?.configuration.changeBlocked
      ).toBe(true);
      expect(
        activeMain.worktrees.find(
          ({ path }) => path === realpathSync(experiment)
        )?.configuration.changeBlocked
      ).toBe(false);
      expect(() =>
        controller.selectWorktreeConfigSource(
          root,
          selectedExperiment?.id ?? "",
          "project-default"
        )
      ).not.toThrow();
      controller.selectWorktreeConfigSource(
        root,
        selectedExperiment?.id ?? "",
        "checkout"
      );

      const activeExperiment = controller
        .inspect(root)
        .worktrees.find(({ path }) => path === realpathSync(experiment));
      const activeExperimentGroup = activeExperiment?.appGroups[0];
      if (!(activeExperiment && activeExperimentGroup)) {
        throw new Error("Expected the experiment App group");
      }
      state.saveRun(
        {
          instanceId: activeExperimentGroup.instance.id,
          repoPath: selected.repoPath,
        },
        {
          apps: {},
          createdAt: new Date().toISOString(),
          groupId: activeExperimentGroup.id,
          instanceId: activeExperimentGroup.instance.id,
          instanceIdsByGroup: {
            [activeExperimentGroup.id]: activeExperimentGroup.instance.id,
          },
          worktreePath: activeExperiment.path,
        }
      );
      expect(() =>
        controller.selectWorktreeConfigSource(
          root,
          activeExperiment.id,
          "project-default"
        )
      ).toThrow("Stop this worktree's App groups");
      writeFileSync(pathModule.join(experiment, ".branchbase.json"), "{");
      const fallback = controller
        .inspect(root)
        .worktrees.find(({ path }) => path === realpathSync(experiment));
      expect(fallback).toMatchObject({
        configuration: {
          error: expect.stringContaining("Invalid checkout configuration"),
          path: pathModule.join(realpathSync(root), ".branchbase.json"),
          preference: "checkout",
          source: "project-default",
        },
        primaryAppGroup: expect.stringMatching(CLEANUP_APP_GROUP),
      });
      const cleanupGroup = fallback?.appGroups.find(
        (group) => group.cleanupOnly === true
      );
      expect(cleanupGroup).toMatchObject({
        instance: { id: activeExperimentGroup.instance.id },
        name: "experiment-apps (cleanup)",
      });
      await controller.stopAppGroup(
        root,
        activeExperiment.id,
        cleanupGroup?.id ?? ""
      );
      expect(
        controller
          .inspect(root)
          .worktrees.find(({ id }) => id === activeExperiment.id)
      ).toMatchObject({
        configuration: { changeBlocked: false },
        primaryAppGroup: "default-apps",
      });
    } finally {
      rmSync(sandbox, { force: true, recursive: true });
    }
  });
});

describe("git worktree discovery", () => {
  it("accepts arbitrary paths and detached worktrees", () => {
    expect(
      parseWorktreeList(`worktree /code/chat-js
HEAD abcdef0123456789
branch refs/heads/main

worktree /tmp/arbitrary-name
HEAD 1234567890abcdef
detached
`)
    ).toEqual([
      {
        branch: "main",
        head: "abcdef0123456789",
        path: "/code/chat-js",
        prunable: false,
      },
      {
        branch: null,
        head: "1234567890abcdef",
        path: "/tmp/arbitrary-name",
        prunable: false,
      },
    ]);
  });
});

describe("visible worktree scope", () => {
  it("limits bulk operations to the identifiers supplied by the table", () => {
    const worktrees = [{ id: "visible" }, { id: "hidden" }];
    expect(selectRequestedWorktrees(worktrees, ["visible"])).toEqual([
      { id: "visible" },
    ]);
  });
});

describe("app lifecycle availability", () => {
  it("offers restart for any running slot-free worktree or App group", () => {
    expect(appsCanRestart({ health: "running", processRunning: true })).toBe(
      true
    );
    expect(
      appsCanRestart({ health: "not-running", processRunning: false })
    ).toBe(false);
    expect(
      appGroupCanRestart({
        health: "partially-running",
        processRunning: false,
      })
    ).toBe(true);
  });

  it("includes running selectable instances that are not selected", () => {
    expect(
      worktreeHasRunningAppGroups({
        appGroups: [
          {
            apps: [],
            health: "not-running",
            id: "services",
            instance: {
              id: "selected",
              mode: "selectable",
              name: "Default",
            },
            instances: [
              { id: "selected", name: "Default", running: false },
              { id: "experiment", name: "Experiment", running: true },
            ],
            name: "Services",
            processRunning: false,
            stop: "command",
          },
        ],
      })
    ).toBe(true);
  });
});

describe("controller command contract", () => {
  it("validates command input before invoking repository operations", async () => {
    const controller = new WorkspaceController();
    await expect(
      controller.execute("start-apps", {
        appGroupName: "",
        repoPath: "/not-inspected",
        worktreeId: "worktree",
      })
    ).rejects.toThrow();
  });

  it("checks repository trust synchronously before App-group operations", () => {
    class UntrustedController extends WorkspaceController {
      // oxlint-disable-next-line eslint/class-methods-use-this -- This test adapter overrides the trust seam.
      override assertTrusted(): never {
        throw new Error("trust checked");
      }
    }

    const controller = new UntrustedController();
    expect(() =>
      controller.retryAppGroup("/not-inspected", "worktree", "apps")
    ).toThrow("trust checked");
    expect(() =>
      controller.startAppGroup("/not-inspected", "worktree", "apps")
    ).toThrow("trust checked");
  });

  it("rejects command working directories that escape through a symlink", () => {
    const sandbox = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-command-cwd-")
    );
    const root = pathModule.join(sandbox, "worktree");
    const outside = pathModule.join(sandbox, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    mkdirSync(pathModule.join(root, "apps"));
    symlinkSync(outside, pathModule.join(root, "linked"));
    try {
      expect(commandWorkingDirectory(root, "apps")).toBe(
        realpathSync(pathModule.join(root, "apps"))
      );
      expect(() => commandWorkingDirectory(root, "../outside")).toThrow(
        "inside the worktree"
      );
      expect(() => commandWorkingDirectory(root, "linked")).toThrow(
        "inside the worktree"
      );
      expect(() => commandWorkingDirectory(root, "missing")).toThrow(
        "must exist inside the worktree"
      );
    } finally {
      rmSync(sandbox, { force: true, recursive: true });
    }
  });
});
