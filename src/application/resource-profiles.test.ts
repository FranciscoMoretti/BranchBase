import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { pollUntil } from "../adapters/host/polling";
import {
  ProcessSupervisor,
  appGroupInstanceProcessId,
} from "../adapters/host/process-supervisor";
import type { LocalRoutingEngine } from "../adapters/routing/portless";
import { FileBranchBaseStateStore } from "../app-group/assignments";
import { BranchBaseConfigSchema } from "../configuration/branchbase-schema";
import { trustRepository } from "../configuration/repository-trust";
import { WorkspaceController } from "./workspace-controller";

const required = <T>(value: T | undefined): T => {
  if (value === undefined) {
    throw new Error("Missing fixture value");
  }
  return value;
};
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
};
const routing: LocalRoutingEngine = {
  activate: async () => {},
  deactivate: async () => {},
  observe: () => "inactive",
  url: (hostname) => `http://${hostname}`,
};

const binding = async (directory: string) => {
  let result: { port: string; instance: string; worktree: string } | undefined;
  await pollUntil(
    () => {
      try {
        result = JSON.parse(
          readFileSync(path.join(directory, "binding.json"), "utf-8")
        );
        return true;
      } catch {
        return false;
      }
    },
    { intervalMs: 30, message: "Worker did not connect", timeoutMs: 3000 }
  );
  return required(result);
};

const fixture = () => {
  const temporary = realpathSync(
    mkdtempSync(path.join(tmpdir(), "branchbase-profiles-"))
  );
  const repository = path.join(temporary, "project");
  const feature = path.join(temporary, "feature");
  mkdirSync(repository);
  git(repository, "init", "-qb", "main");
  git(repository, "config", "user.email", "test@example.test");
  git(repository, "config", "user.name", "Test");
  const config = BranchBaseConfigSchema.parse({
    appGroups: {
      database: {
        apps: { db: { protocol: "tcp" } },
        category: "infrastructure",
        env: { INSTANCE: "{instance.id}", PORT: "{apps.db.port}" },
        start: { argv: [process.execPath, "database.ts"] },
        stop: "process",
      },
      worker: {
        apps: {},
        env: {
          DATABASE_PORT: "{appGroups.database.apps.db.port}",
          INSTANCE: "{instance.id}",
          WORKTREE: "{worktree.id}",
        },
        start: { argv: [process.execPath, "worker.ts"] },
        stop: "process",
      },
    },
    profiles: {
      default: "shared",
      definitions: {
        external: {
          connections: {
            database: { policy: "existing", resource: "local-db" },
          },
          name: "Existing database",
        },
        isolated: {
          connections: {
            database: { idle: "stop-when-unused", policy: "worktree" },
          },
          name: "Isolated development",
        },
        shared: {
          connections: {
            database: { idle: "stop-when-unused", policy: "project" },
          },
          name: "Shared development",
        },
      },
      rules: [{ branch: "experiment/*", profile: "isolated" }],
    },
    setup: { argv: ["true"] },
    version: 1,
  });
  writeFileSync(
    path.join(repository, ".branchbase.json"),
    JSON.stringify(config)
  );
  writeFileSync(
    path.join(repository, "database.ts"),
    `import {createServer} from 'node:net'; import {appendFileSync} from 'node:fs'; createServer(socket => socket.end()).listen(Number(process.env.PORT), '127.0.0.1', () => appendFileSync('database-starts.txt', process.env.INSTANCE+'\\n'));`
  );
  writeFileSync(
    path.join(repository, "worker.ts"),
    `import {createConnection} from 'node:net'; import {writeFileSync} from 'node:fs'; const socket=createConnection({host:'127.0.0.1',port:Number(process.env.DATABASE_PORT)},()=>{writeFileSync('binding.json',JSON.stringify({port:process.env.DATABASE_PORT,instance:process.env.INSTANCE,worktree:process.env.WORKTREE}));socket.end()});socket.on('error',()=>process.exit(1));setInterval(()=>{},1000);`
  );
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "fixture");
  git(repository, "worktree", "add", "-qb", "feature/api", feature);
  const processes = new ProcessSupervisor(path.join(temporary, "control"));
  const state = new FileBranchBaseStateStore(
    path.join(temporary, "control", "state.json")
  );
  const controller = new WorkspaceController(undefined, {
    processes,
    routing,
    state,
  });
  trustRepository(repository, config, processes.controlDirectory);
  const { worktrees } = controller.inspect(repository);
  const mainId = required(worktrees.find((worktree) => worktree.isMain)).id;
  const featureId = required(worktrees.find((worktree) => !worktree.isMain)).id;
  const group = (id: string, groupId: string) =>
    required(
      required(
        controller
          .inspect(repository)
          .worktrees.find((worktree) => worktree.id === id)
      ).appGroups.find((item) => item.id === groupId)
    );
  const close = async () => {
    for (const instance of state.allInstances(repository)) {
      if (!instance.run) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Clean up every test-owned process before removing its directory.
      await processes.stopManagedProcess(
        appGroupInstanceProcessId(instance.id),
        instance.run.worktreePath
      );
    }
    await controller.close();
    rmSync(temporary, { force: true, recursive: true });
  };
  return {
    binding,
    close,
    config,
    controller,
    feature,
    featureId,
    group,
    mainId,
    processes,
    repository,
    state,
    temporary,
  };
};

describe("resource profile lifecycle", () => {
  it("previews without provisioning and reuses one project resource until the last consumer stops", async () => {
    const f = fixture();
    try {
      const preview = f.controller.previewResourceProfile(
        f.repository,
        f.featureId,
        "isolated"
      );
      expect(preview.connections[0].resourceId).toBe("");
      expect(
        f.state.allInstances(f.repository).every((instance) => !instance.run)
      ).toBe(true);
      expect(f.processes.listManagedProcesses()).toHaveLength(0);
      expect(f.group(f.mainId, "database").apps[0].port).toBeNull();
      await Promise.all([
        f.controller.startAppGroup(f.repository, f.mainId, "worker"),
        f.controller.startAppGroup(f.repository, f.featureId, "worker"),
      ]);
      const mainBinding = await f.binding(f.repository);
      const featureBinding = await f.binding(f.feature);
      const database = f.group(f.mainId, "database");
      expect(mainBinding.port).toBe(featureBinding.port);
      expect(mainBinding.instance).not.toBe(featureBinding.instance);
      expect(mainBinding.worktree).not.toBe(featureBinding.worktree);
      expect(f.group(f.featureId, "database").instance.id).toBe(
        database.instance.id
      );
      expect(
        readFileSync(path.join(f.repository, "database-starts.txt"), "utf-8")
          .trim()
          .split("\n")
      ).toHaveLength(1);
      await expect(
        f.controller.stopAppGroup(f.repository, f.mainId, "database")
      ).rejects.toThrow("in use");
      await f.controller.stopAppGroup(f.repository, f.mainId, "worker");
      expect(f.group(f.featureId, "database").health).toBe("running");
      await f.controller.stopAppGroup(f.repository, f.featureId, "worker");
      expect(f.group(f.mainId, "database").health).toBe("not-running");
      await f.controller.startAppGroup(f.repository, f.featureId, "worker");
      expect(f.group(f.featureId, "database").instance.id).toBe(
        database.instance.id
      );
      await f.controller.stopAppGroup(f.repository, f.featureId, "worker");
    } finally {
      await f.close();
    }
  }, 30_000);

  it("switches a running consumer explicitly and preserves the other worktree's resource", async () => {
    const f = fixture();
    try {
      await f.controller.startAppGroup(f.repository, f.mainId, "worker");
      await f.controller.startAppGroup(f.repository, f.featureId, "worker");
      const shared = f.group(f.mainId, "database");
      await expect(
        f.controller.selectResourceProfile(
          f.repository,
          f.featureId,
          "isolated",
          false
        )
      ).rejects.toThrow("Restart");
      rmSync(path.join(f.feature, "binding.json"), { force: true });
      await f.controller.selectResourceProfile(
        f.repository,
        f.featureId,
        "isolated",
        true
      );
      const isolated = f.group(f.featureId, "database");
      expect(isolated.instance.id).not.toBe(shared.instance.id);
      const isolatedBinding = await f.binding(f.feature);
      expect(isolatedBinding.port).toBe(String(isolated.apps[0].port));
      expect(f.group(f.mainId, "database").health).toBe("running");
      await f.controller.selectResourceProfile(
        f.repository,
        f.mainId,
        "isolated",
        true
      );
      // Both consumers have left the shared resource; its captured idle policy stops it.
      expect(
        f.state.instanceById(f.repository, shared.instance.id)?.run
      ).toBeNull();

      await f.controller.restartAppGroup(f.repository, f.featureId, "worker");
      expect(f.group(f.featureId, "database").instance.id).toBe(
        isolated.instance.id
      );
      await f.controller.execute("stop-all-apps", {
        repoPath: f.repository,
        worktreeIds: [f.featureId],
      });
      expect(f.group(f.featureId, "database").health).toBe("not-running");
      expect(f.group(f.mainId, "database").health).toBe("running");
      await f.controller.stopAppGroup(f.repository, f.mainId, "worker");
    } finally {
      await f.close();
    }
  }, 30_000);

  it("connects external endpoints without owning their process and reports missing resources", async () => {
    const f = fixture();
    const server = createServer((socket) => socket.end());
    try {
      const preview = f.controller.previewResourceProfile(
        f.repository,
        f.mainId,
        "external"
      );
      expect(preview.connections[0].error).toContain(
        "Connect existing resource"
      );
      await expect(
        f.controller.selectResourceProfile(
          f.repository,
          f.mainId,
          "external",
          false
        )
      ).rejects.toThrow("Connect existing resource");
      const listening = once(server, "listening");
      server.listen(0, "127.0.0.1");
      await listening;
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Missing listener address");
      }
      f.controller.registerResource({
        apps: {
          db: { host: "127.0.0.1", port: address.port, protocol: "tcp" },
        },
        id: "local-db",
        name: "Existing Postgres",
      });
      await f.controller.selectResourceProfile(
        f.repository,
        f.mainId,
        "external",
        false
      );
      expect(f.processes.listManagedProcesses()).toHaveLength(0);
      await f.controller.startAppGroup(f.repository, f.mainId, "worker");
      const externalBinding = await f.binding(f.repository);
      expect(externalBinding.port).toBe(String(address.port));
      expect(f.group(f.mainId, "database").external).toBe(true);
      expect(
        f.state
          .allInstances(f.repository)
          .filter((instance) => instance.run)
          .map((instance) => instance.groupId)
      ).toEqual(["worker"]);
      await f.controller.stopAppGroup(f.repository, f.mainId, "worker");
      await f.controller.stopAppGroup(f.repository, f.mainId, "database");
      expect(server.listening).toBe(true);
      await f.controller.selectResourceProfile(
        f.repository,
        f.mainId,
        "shared",
        false
      );
      await f.controller.startAppGroup(f.repository, f.mainId, "worker");
      await f.controller.selectResourceProfile(
        f.repository,
        f.featureId,
        "external",
        false
      );
      await f.controller.startAppGroup(f.repository, f.featureId, "worker");
      expect(f.group(f.featureId, "worker").dependencies?.[0].instanceId).toBe(
        "external:local-db"
      );
      await f.controller.stopAppGroup(f.repository, f.mainId, "worker");
      expect(f.group(f.mainId, "database").health).toBe("not-running");
      expect(f.group(f.featureId, "worker").processRunning).toBe(true);
      await f.controller.stopAppGroup(f.repository, f.featureId, "worker");
    } finally {
      server.close();
      await f.close();
    }
  }, 15_000);
  it("keeps unused resources when requested and persists profile selection", async () => {
    const f = fixture();
    try {
      const profiles = required(f.config.profiles);
      profiles.definitions.shared.connections.database = {
        idle: "keep-running",
        policy: "project",
      };
      writeFileSync(
        path.join(f.repository, ".branchbase.json"),
        JSON.stringify(f.config)
      );
      trustRepository(f.repository, f.config, f.processes.controlDirectory);
      await f.controller.startAppGroup(f.repository, f.featureId, "worker");
      await f.controller.stopAppGroup(f.repository, f.featureId, "worker");
      const shared = f.group(f.mainId, "database");
      expect(shared.health).toBe("running");
      await f.controller.selectResourceProfile(
        f.repository,
        f.featureId,
        "isolated",
        false
      );
      const reloaded = new WorkspaceController(undefined, {
        processes: f.processes,
        routing,
        state: f.state,
      });
      try {
        expect(
          reloaded
            .inspect(f.repository)
            .worktrees.find((worktree) => worktree.id === f.featureId)?.profile
            ?.id
        ).toBe("isolated");
      } finally {
        await reloaded.close();
      }
      await f.controller.stopAppGroup(f.repository, f.mainId, "database");
      profiles.default = "external";
      writeFileSync(
        path.join(f.repository, ".branchbase.json"),
        JSON.stringify(f.config)
      );
      const unavailable = f.controller
        .inspect(f.repository)
        .worktrees.find((worktree) => worktree.isMain);
      expect(unavailable?.profile?.connections[0].error).toContain(
        "Connect existing resource"
      );
      expect(
        unavailable?.appGroups.find((group) => group.id === "database")
          ?.external
      ).toBe(true);
    } finally {
      await f.close();
    }
  }, 15_000);
  it("protects a shared resource exposed as a detached cleanup target", async () => {
    const f = fixture();
    try {
      await f.controller.startAppGroup(f.repository, f.mainId, "worker");
      await f.controller.startAppGroup(f.repository, f.featureId, "worker");
      const shared = f.group(f.mainId, "database");
      await f.controller.selectResourceProfile(
        f.repository,
        f.mainId,
        "isolated",
        true
      );
      const main = required(
        f.controller
          .inspect(f.repository)
          .worktrees.find((worktree) => worktree.isMain)
      );
      const cleanup = required(
        main.appGroups.find(
          (group) =>
            group.cleanupOnly && group.instance.id === shared.instance.id
        )
      );
      await expect(
        f.controller.stopAppGroup(f.repository, f.mainId, cleanup.id)
      ).rejects.toThrow("in use");
      expect(f.group(f.featureId, "database").health).toBe("running");
    } finally {
      await f.close();
    }
  }, 15_000);
});
