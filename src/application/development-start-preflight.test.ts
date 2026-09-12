import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { ProcessSupervisor } from "../adapters/host/process-supervisor";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../adapters/routing/portless";
import { FileBranchBaseStateStore } from "../app-group/assignments";
import { WorkspaceController } from "./workspace-controller";

const inMemoryRoutingEngine = (): LocalRoutingEngine => ({
  activate: (_route: LocalRoute) => Promise.resolve(),
  deactivate: (_route: LocalRoute) => Promise.resolve(),
  observe: (_route: LocalRoute): LocalRouteState => "inactive",
  prepare: () => Promise.resolve(),
  url: (hostname: string) => `http://${hostname}:1355`,
});

const git = (cwd: string, ...args: string[]): void => {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
};

it("runs the development Start preflight before local state or repository code", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-start-preflight-")
  );
  const repository = pathModule.join(temporary, "project");
  const marker = pathModule.join(temporary, "repository-command-ran");
  mkdirSync(repository);
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "branchbase@example.test");
  git(repository, "config", "user.name", "BranchBase Test");
  writeFileSync(
    pathModule.join(repository, ".branchbase.json"),
    JSON.stringify({
      appGroups: {
        Chat: {
          apps: { chat: { protocol: "http", readiness: "tcp" } },
          env: { PORT: "{apps.chat.port}" },
          start: {
            argv: [
              process.execPath,
              "-e",
              `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`,
            ],
          },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 1,
    })
  );
  git(repository, "add", ".branchbase.json");
  git(repository, "commit", "-qm", "test config");

  const statePath = pathModule.join(temporary, "state.json");
  const controller = new WorkspaceController(undefined, {
    developmentStartPreflight: () => {
      throw new Error("Production BranchBase is already using this worktree");
    },
    processes: new ProcessSupervisor(pathModule.join(temporary, "processes")),
    routing: inMemoryRoutingEngine(),
    state: new FileBranchBaseStateStore(statePath),
  });
  const worktreeId = Buffer.from(realpathSync(repository)).toString(
    "base64url"
  );

  try {
    await expect(
      controller.startAppGroup(repository, worktreeId, "Chat")
    ).rejects.toThrow("Production BranchBase is already using this worktree");
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally {
    try {
      await controller.stopAppGroup(repository, worktreeId, "Chat");
    } catch {
      // The preflight should prevent a run from existing.
    }
    await controller.close();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("describes repository discovery failures before invoking the preflight", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-start-preflight-invalid-repository-")
  );
  let preflightCalled = false;
  const controller = new WorkspaceController(undefined, {
    developmentStartPreflight: () => {
      preflightCalled = true;
    },
    processes: new ProcessSupervisor(pathModule.join(temporary, "processes")),
    routing: inMemoryRoutingEngine(),
    state: new FileBranchBaseStateStore(
      pathModule.join(temporary, "state.json")
    ),
  });

  try {
    await expect(
      controller.startAppGroup(temporary, "unknown", "Chat")
    ).rejects.toThrow(
      `Could not resolve BranchBase worktrees for "${temporary}"`
    );
    expect(preflightCalled).toBe(false);
  } finally {
    await controller.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});
