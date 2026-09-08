import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import {
  repositoryCommandFingerprint,
  trustRepository,
} from "../config/repository-trust";
import type { LocalRoutingEngine } from "../runtime/local-routing";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { AppGroupRuntime } from "./app-group-runtime";
import { WorkspaceController } from "./workspace-controller";

type InMemoryRoutingEngine = LocalRoutingEngine & {
  point: (hostname: string, port: number) => void;
  prepared: boolean;
};

const inMemoryRoutingEngine = (): InMemoryRoutingEngine => {
  const routes = new Map<string, number>();
  const routing: InMemoryRoutingEngine = {
    activate: async (route) => {
      if (!routing.prepared) {
        throw new Error("Routing activated before preflight");
      }
      routes.set(route.hostname, route.port);
    },
    deactivate: async (route) => {
      routes.delete(route.hostname);
    },
    observe: (route) => {
      const port = routes.get(route.hostname);
      if (port === undefined) {
        return "inactive" as const;
      }
      return port === route.port ? ("active" as const) : ("conflict" as const);
    },
    point: (hostname, port) => {
      routes.set(hostname, port);
    },
    prepare: async () => {
      routing.prepared = true;
    },
    prepared: false,
    url: (hostname) => `http://${hostname}:1355`,
  };
  return routing;
};

const failingPrepareRoutingEngine = (): InMemoryRoutingEngine => {
  const routing = inMemoryRoutingEngine();
  routing.prepare = () => Promise.reject(new Error("Portless unavailable"));
  return routing;
};

type BlockingPrepareRoutingEngine = InMemoryRoutingEngine & {
  release: () => void;
};

const blockingPrepareRoutingEngine = (): BlockingPrepareRoutingEngine => {
  let released = false;
  let releasePrepare: (() => void) | null = null;
  const routing = inMemoryRoutingEngine() as BlockingPrepareRoutingEngine;
  routing.prepare = () => {
    if (released) {
      routing.prepared = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      releasePrepare = resolve;
    });
  };
  routing.release = () => {
    released = true;
    routing.prepared = true;
    releasePrepare?.();
  };
  return routing;
};

type RecoverableActivationRoutingEngine = InMemoryRoutingEngine & {
  recover: () => void;
};

const recoverableActivationRoutingEngine =
  (): RecoverableActivationRoutingEngine => {
    let failing = true;
    const routing =
      inMemoryRoutingEngine() as RecoverableActivationRoutingEngine;
    const activate = routing.activate;
    routing.activate = (route) =>
      failing
        ? Promise.reject(new Error("Portless route activation failed"))
        : activate(route);
    routing.recover = () => {
      failing = false;
    };
    return routing;
  };

class TrustedWorkspaceController extends WorkspaceController {
  // oxlint-disable-next-line eslint/class-methods-use-this -- This test adapter overrides the trust seam.
  override assertTrusted(): void {
    // This fixture controls every command and does not touch repository trust.
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- This test adapter overrides the config trust seam.
  protected override assertConfigTrusted(): void {
    // This fixture controls every command and does not touch repository trust.
  }
}

const git = (cwd: string, ...args: string[]): void => {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
};

const createSelectableInstanceFixture = (): {
  controller: WorkspaceController;
  featureWorktree: string;
  repository: string;
  temporary: string;
} => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-instances-")
  );
  const repository = pathModule.join(temporary, "project");
  const featureWorktree = pathModule.join(temporary, "project-feature");
  mkdirSync(repository);
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "branchbase@example.test");
  git(repository, "config", "user.name", "BranchBase Test");
  writeFileSync(
    pathModule.join(repository, ".branchbase.json"),
    JSON.stringify({
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        Apps: {
          start: { argv: ["true"] },
          stop: "process",
          apps: { Web: { protocol: "http" } },
        },
        Services: {
          instances: { mode: "selectable" },
          start: { argv: ["true"] },
          stop: { argv: ["true"] },
          apps: { Database: { protocol: "tcp" } },
        },
      },
    })
  );
  git(repository, "add", ".branchbase.json");
  git(repository, "commit", "-qm", "test config");
  git(repository, "worktree", "add", "-qb", "feature", featureWorktree);
  const controller = new WorkspaceController(undefined, {
    routing: inMemoryRoutingEngine(),
    processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
    state: new FileBranchBaseStateStore(
      pathModule.join(temporary, "state.json")
    ),
  });
  return { controller, featureWorktree, repository, temporary };
};

const requiredWorktree = (
  snapshot: ReturnType<WorkspaceController["inspect"]>,
  isMain: boolean
) => {
  const worktree = snapshot.worktrees.find((item) => item.isMain === isMain);
  if (!worktree) {
    throw new Error(`Missing ${isMain ? "main" : "feature"} worktree`);
  }
  return worktree;
};

const requiredAppGroup = (
  worktree: ReturnType<typeof requiredWorktree>,
  id: string
) => {
  const group = worktree.appGroups.find((item) => item.id === id);
  if (!group) {
    throw new Error(`Missing App group ${id}`);
  }
  return group;
};

const requiredApp = (
  group: ReturnType<typeof requiredAppGroup>,
  id: string
) => {
  const app = group.apps.find((item) => item.id === id);
  if (!app) {
    throw new Error(`Missing App ${id}`);
  }
  return app;
};

const listenerPort = (server: Server): number => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test listener did not expose a TCP port");
  }
  return address.port;
};

const requiredRun = (
  state: FileBranchBaseStateStore,
  key: { instanceId: string; repoPath: string }
) => {
  const run = state.run(key);
  if (!run) {
    throw new Error("Expected a persisted App-group run");
  }
  return run;
};

const requiredDatabaseEndpoint = (run: ReturnType<typeof requiredRun>) => {
  const database = run.apps.Database;
  if (!database) {
    throw new Error("Expected a persisted Database endpoint");
  }
  return database;
};

const createCrossGroupFixture = (): {
  controller: TrustedWorkspaceController;
  repository: string;
  routing: InMemoryRoutingEngine;
  temporary: string;
  worktreeId: string;
} => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-runtime-")
  );
  const repository = pathModule.join(temporary, "project");
  mkdirSync(repository);
  git(repository, "init", "-q");
  writeFileSync(
    pathModule.join(repository, ".branchbase.json"),
    JSON.stringify({
      version: 1,
      setup: { argv: ["true"] },
      appGroups: {
        Apps: {
          start: {
            argv: [
              "bun",
              "-e",
              "const fs=require('node:fs');const http=require('node:http');fs.writeFileSync('resolved-env.txt',process.env.DATABASE_PORT+'\\n'+process.env.WEB_PORT);http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
            ],
          },
          stop: "process",
          env: {
            DATABASE_PORT: "{appGroups.Services.apps.Database.port}",
            SLOW_PORT: "{apps.Slow.port}",
            WEB_PORT: "{apps.Web.port}",
          },
          apps: {
            Slow: {
              protocol: "http",
              readiness: {
                path: "/",
                statuses: "200-399",
                timeoutSeconds: 1,
                type: "http",
              },
            },
            Web: { protocol: "http" },
          },
        },
        Services: {
          instances: { mode: "selectable" },
          start: { argv: ["true"] },
          stop: { argv: ["true"] },
          apps: { Database: { protocol: "tcp" } },
        },
      },
    })
  );
  const routing = inMemoryRoutingEngine();
  const controller = new TrustedWorkspaceController(undefined, {
    routing,
    processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
    state: new FileBranchBaseStateStore(
      pathModule.join(temporary, "state.json")
    ),
  });
  const worktreeId = requiredWorktree(controller.inspect(repository), true).id;
  return { controller, repository, routing, temporary, worktreeId };
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const cleanupCrossGroupFixture = async (fixture: {
  blocker: Server | null;
  controller: TrustedWorkspaceController;
  repository: string;
  temporary: string;
  worktreeId: string;
}): Promise<void> => {
  if (fixture.blocker) {
    await close(fixture.blocker).catch(() => undefined);
  }
  await fixture.controller
    .stopAppGroup(fixture.repository, fixture.worktreeId, "Apps")
    .catch(() => undefined);
  rmSync(fixture.temporary, { force: true, recursive: true });
};

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

describe("App-group instance assignment", () => {
  it("uses an approved captured Stop command for a detached run", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-cleanup-stop-")
    );
    try {
      const controlDirectory = pathModule.join(temporary, "control");
      const marker = pathModule.join(temporary, "stopped");
      const config = {
        appGroups: {
          Services: {
            apps: {},
            instances: { mode: "per-worktree" as const },
            start: { argv: ["true"] },
            stop: { argv: ["true"] },
          },
        },
        setup: { argv: ["true"] },
        version: 1 as const,
      };
      const state = new FileBranchBaseStateStore(
        pathModule.join(temporary, "state.json")
      );
      const instance = state.instance({
        configFingerprint: repositoryCommandFingerprint(config),
        groupId: "Services",
        mode: "per-worktree",
        repoLabel: "project",
        repoPath: temporary,
        worktreeLabel: "main",
        worktreePath: temporary,
      });
      state.saveRun(
        { instanceId: instance.id, repoPath: temporary },
        {
          apps: {},
          createdAt: new Date().toISOString(),
          groupId: "Services",
          instanceId: instance.id,
          instanceIdsByGroup: { Services: instance.id },
          stop: {
            argv: [
              "bun",
              "-e",
              `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "stopped")`,
            ],
            env: {},
          },
          worktreePath: temporary,
        }
      );
      trustRepository(temporary, config, controlDirectory);
      const runtime = new AppGroupRuntime(
        new ProcessSupervisor(controlDirectory),
        inMemoryRoutingEngine(),
        state
      );

      await runtime.stopDetached(
        temporary,
        temporary,
        `cleanup:${instance.id}`
      );

      expect(readFileSync(marker, "utf-8")).toBe("stopped");
      expect(state.run({ instanceId: instance.id, repoPath: temporary })).toBe(
        null
      );
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("exposes in-flight lifecycle work before a run is persisted", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-pending-start-")
    );
    try {
      const routing = blockingPrepareRoutingEngine();
      const runtime = new AppGroupRuntime(
        new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing,
        new FileBranchBaseStateStore(pathModule.join(temporary, "state.json"))
      );
      const target = {
        config: {
          appGroups: {
            Apps: {
              apps: {},
              instances: { mode: "per-worktree" as const },
              start: { argv: ["true"] },
              stop: "process" as const,
            },
          },
          setup: { argv: ["true"] },
          version: 1 as const,
        },
        groupId: "Apps",
        repoPath: temporary,
        worktree: { id: "main", path: temporary, routeLabel: "main" },
      };

      const started = runtime.start(target);
      expect(runtime.hasPendingLifecycle(temporary)).toBe(true);
      expect(runtime.inspect(target, { pidsByPort: new Map() }).pending).toBe(
        true
      );
      routing.release();
      await started;
      expect(runtime.hasPendingLifecycle(temporary)).toBe(false);
      expect(runtime.inspect(target, { pidsByPort: new Map() }).pending).toBe(
        false
      );
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("shares selectable defaults and lets one worktree switch to an isolated instance", () => {
    const { controller, repository, temporary } =
      createSelectableInstanceFixture();
    try {
      const initial = controller.inspect(repository);
      const main = requiredWorktree(initial, true);
      const feature = requiredWorktree(initial, false);
      const mainApps = requiredAppGroup(main, "Apps");
      const featureApps = requiredAppGroup(feature, "Apps");
      expect(mainApps.instance.mode).toBe("per-worktree");
      expect(mainApps.instance.id).not.toBe(featureApps.instance.id);

      const mainServices = requiredAppGroup(main, "Services");
      const featureServices = requiredAppGroup(feature, "Services");
      expect(mainServices.instance.name).toBe("Default");
      expect(mainServices.instance.id).toBe(featureServices.instance.id);

      controller.createAppGroupInstance(
        repository,
        feature.id,
        "Services",
        "Migration experiment"
      );
      const isolated = controller.inspect(repository);
      const isolatedMain = requiredAppGroup(
        requiredWorktree(isolated, true),
        "Services"
      );
      const isolatedFeature = requiredAppGroup(
        requiredWorktree(isolated, false),
        "Services"
      );

      expect(isolatedMain.instance.name).toBe("Default");
      expect(isolatedFeature.instance.name).toBe("Migration experiment");
      expect(
        isolatedFeature.instances.map((instance) => instance.name)
      ).toEqual(["Default", "Migration experiment"]);

      controller.selectAppGroupInstance(
        repository,
        feature.id,
        "Services",
        isolatedMain.instance.id
      );
      const sharedAgain = controller.inspect(repository);
      expect(
        requiredAppGroup(requiredWorktree(sharedAgain, false), "Services")
          .instance.id
      ).toBe(isolatedMain.instance.id);
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("serializes concurrent Starts of a shared instance across worktrees", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-shared-start-")
    );
    const repository = pathModule.join(temporary, "project");
    const featureWorktree = pathModule.join(temporary, "project-feature");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let mainId = "";
    let featureId = "";
    try {
      git(repository, "init", "-q");
      git(repository, "config", "user.email", "branchbase@example.test");
      git(repository, "config", "user.name", "BranchBase Test");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Services: {
              instances: { mode: "selectable" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:net').createServer().listen(Number(process.env.SERVICE_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: { SERVICE_PORT: "{apps.Service.port}" },
              apps: { Service: { protocol: "tcp" } },
            },
          },
        })
      );
      git(repository, "add", ".branchbase.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      const initial = controller.inspect(repository);
      mainId = initial.worktrees.find((worktree) => worktree.isMain)?.id ?? "";
      featureId =
        initial.worktrees.find((worktree) => !worktree.isMain)?.id ?? "";
      const instanceIds = initial.worktrees.map(
        (worktree) => worktree.appGroups[0]?.instance.id
      );
      expect(new Set(instanceIds).size).toBe(1);

      const results = await Promise.all([
        controller.startAppGroup(repository, mainId, "Services"),
        controller.startAppGroup(repository, featureId, "Services"),
      ]);
      expect(results.toSorted()).toEqual(["already-running", "started"]);
      const running = controller.inspect(repository);
      expect(running.globalRunningCount).toBe(1);
      expect(
        running.worktrees.every(
          (worktree) => worktree.appGroups[0]?.health === "running"
        )
      ).toBe(true);
    } finally {
      if (controller && mainId) {
        await controller
          .stopAppGroup(repository, mainId, "Services")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("materializes cross-group ports before Start and keeps them stable across Restart", async () => {
    const fixture = createCrossGroupFixture();
    const { controller, repository, routing, temporary, worktreeId } = fixture;
    let blocker: Server | null = null;
    try {
      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(routing.prepared).toBe(true);
      const running = requiredWorktree(controller.inspect(repository), true);
      const apps = requiredAppGroup(running, "Apps");
      const services = requiredAppGroup(running, "Services");
      expect(apps.run).toEqual({
        startedAt: expect.any(String),
        worktreePath: running.path,
      });
      expect(apps.dependencies).toEqual([
        {
          groupId: "Services",
          instanceId: services.instance.id,
          name: services.instance.name,
        },
      ]);
      expect(apps.health).toBe("partially-running");
      const webPort = requiredApp(apps, "Web").port;
      const databasePort = requiredApp(services, "Database").port;
      expect(webPort).toBeNumber();
      expect(databasePort).toBeNumber();
      expect(
        readFileSync(
          pathModule.join(repository, "resolved-env.txt"),
          "utf-8"
        ).split("\n")
      ).toEqual([String(databasePort), String(webPort)]);

      blocker = createServer();
      await listen(blocker, databasePort as number);
      await expect(
        controller.startAppGroup(repository, worktreeId, "Services")
      ).rejects.toThrow("occupied by an unrelated process");
      await close(blocker);
      blocker = null;

      expect(
        await controller.stopAppGroup(repository, worktreeId, "Apps")
      ).toBe("stopped");
      const stoppedPort = requiredApp(
        requiredAppGroup(
          requiredWorktree(controller.inspect(repository), true),
          "Apps"
        ),
        "Web"
      ).port;
      expect(stoppedPort).toBe(webPort);

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(
        requiredApp(
          requiredAppGroup(
            requiredWorktree(controller.inspect(repository), true),
            "Apps"
          ),
          "Web"
        ).port
      ).toBe(webPort);

      const webHostname = new URL(
        requiredApp(
          requiredAppGroup(
            requiredWorktree(controller.inspect(repository), true),
            "Apps"
          ),
          "Web"
        ).url ?? ""
      ).hostname;
      routing.point(webHostname, (webPort as number) + 1);
      await expect(
        controller.stopAppGroup(repository, worktreeId, "Apps")
      ).rejects.toThrow("points to a different Backing endpoint");
      routing.point(webHostname, webPort as number);
      expect(
        await controller.stopAppGroup(repository, worktreeId, "Apps")
      ).toBe("stopped");
    } finally {
      await cleanupCrossGroupFixture({
        blocker,
        controller,
        repository,
        temporary,
        worktreeId,
      });
    }
  }, 15_000);

  it("fails Portless preflight before executing repository code", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-preflight-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:fs').writeFileSync('started.txt','yes')",
                ],
              },
              stop: "process",
              apps: { Web: { protocol: "http" } },
            },
          },
        })
      );
      const controller = new TrustedWorkspaceController(undefined, {
        routing: failingPrepareRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      const id = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, id, "Apps")
      ).rejects.toMatchObject({
        code: "routing-unavailable",
        message: "Portless unavailable",
      });
      expect(existsSync(pathModule.join(repository, "started.txt"))).toBe(
        false
      );
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("reports a stable code when the Start command cannot launch", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-start-failure-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: { argv: [`missing-branchbase-command-${process.pid}`] },
              stop: "process",
              apps: { Api: { protocol: "tcp" } },
            },
          },
        })
      );
      const controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      const id = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, id, "Apps")
      ).rejects.toMatchObject({ code: "start-failed" });
    } finally {
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("keeps a ready process available for diagnostics when routing fails", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-routing-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:http').createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: { WEB_PORT: "{apps.Web.port}" },
              apps: { Web: { protocol: "http" } },
            },
          },
        })
      );
      const routing = recoverableActivationRoutingEngine();
      controller = new TrustedWorkspaceController(undefined, {
        routing,
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, worktreeId, "Apps")
      ).rejects.toThrow("Portless route activation failed");
      const endpoint = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web");
      expect(endpoint?.readiness).toBe("ready");
      expect(endpoint?.routeState).toBe("unavailable");
      expect(endpoint?.directUrl).toStartWith("http://127.0.0.1:");
      expect(endpoint?.open).toBe(false);

      routing.recover();
      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      const recovered = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web");
      expect(recovered?.routeState).toBe("active");
      expect(recovered?.open).toBe(true);
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("retries readiness for a sibling that already owns its backing port", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-readiness-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');const http=require('node:http');http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1');http.createServer((_request,response)=>(response.statusCode=fs.existsSync('delayed-ready')?200:503,response.end('status'))).listen(Number(process.env.DELAYED_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
              env: {
                DELAYED_PORT: "{apps.Delayed.port}",
                WEB_PORT: "{apps.Web.port}",
              },
              apps: {
                Delayed: {
                  protocol: "http",
                  readiness: {
                    path: "/",
                    statuses: "200-399",
                    timeoutSeconds: 1,
                    type: "http",
                  },
                },
                Web: { protocol: "http" },
              },
            },
          },
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(
        controller.inspect(repository).worktrees[0]?.appGroups[0]?.health
      ).toBe("partially-running");

      writeFileSync(pathModule.join(repository, "delayed-ready"), "yes");
      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      const recovered =
        controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(recovered?.health).toBe("running");
      expect(recovered?.apps.every((app) => app.routeState === "active")).toBe(
        true
      );
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("keeps an all-unready command App group stoppable and retryable", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-unready-command-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Services: {
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');fs.writeFileSync('start-count',String(Number(fs.existsSync('start-count')?fs.readFileSync('start-count','utf8'):0)+1));require('node:http').createServer((_request,response)=>(response.statusCode=fs.existsSync('service-ready')?200:503,response.end('status'))).listen(Number(process.env.SERVICE_PORT),'127.0.0.1')",
                ],
              },
              stop: { argv: ["true"] },
              env: { SERVICE_PORT: "{apps.Service.port}" },
              apps: {
                Service: {
                  protocol: "http",
                  readiness: {
                    path: "/",
                    statuses: "200-399",
                    timeoutSeconds: 1,
                    type: "http",
                  },
                },
              },
            },
          },
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      await expect(
        controller.startAppGroup(repository, worktreeId, "Services")
      ).rejects.toThrow();
      const unready = controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(unready?.health).toBe("partially-running");
      expect(unready?.apps[0]?.listening).toBe(true);
      expect(unready?.instances[0]?.running).toBe(true);
      expect(
        readFileSync(pathModule.join(repository, "start-count"), "utf-8")
      ).toBe("1");

      writeFileSync(pathModule.join(repository, "service-ready"), "yes");
      expect(
        await controller.retryAppGroup(repository, worktreeId, "Services")
      ).toBe("retried");
      expect(
        controller.inspect(repository).worktrees[0]?.appGroups[0]?.health
      ).toBe("running");
      expect(
        readFileSync(pathModule.join(repository, "start-count"), "utf-8")
      ).toBe("1");
    } finally {
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Services")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 10_000);

  it("requires a durable ownership claim for a command listener", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-ownership-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    const listener = createServer();
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Services: {
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      const state = new FileBranchBaseStateStore(
        pathModule.join(temporary, "state.json")
      );
      const controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state,
      });
      const initial = controller.inspect(repository);
      const worktree = requiredWorktree(initial, true);
      const group = requiredAppGroup(worktree, "Services");
      await listen(listener, 0);
      const port = listenerPort(listener);
      const key = {
        instanceId: group.instance.id,
        repoPath: initial.repoPath,
      };
      state.assignEndpointPort(key, "Database", port);
      state.saveRun(key, {
        apps: {
          Database: {
            appId: "Database",
            host: "127.0.0.1",
            port,
            protocol: "tcp",
          },
        },
        createdAt: new Date().toISOString(),
        groupId: "Services",
        instanceId: key.instanceId,
        instanceIdsByGroup: { Services: key.instanceId },
        worktreePath: worktree.path,
      });

      const inspected = requiredAppGroup(
        requiredWorktree(controller.inspect(repository), true),
        "Services"
      );
      const inspectedApp = requiredApp(inspected, "Database");
      expect(inspectedApp.listening).toBe(false);
      expect(inspectedApp.ownership).toBe("foreign");
      expect(inspectedApp.readiness).toBe("unready");
      expect(inspected.health).toBe("not-running");
      expect(inspected.instances[0]?.running).toBe(false);

      const claimedRun = requiredRun(state, key);
      const database = requiredDatabaseEndpoint(claimedRun);
      database.listenerClaimed = true;
      state.saveRun(key, claimedRun);

      const replacedListener = requiredAppGroup(
        requiredWorktree(controller.inspect(repository), true),
        "Services"
      );
      const replacedApp = requiredApp(replacedListener, "Database");
      expect(replacedApp.listening).toBe(true);
      expect(replacedApp.ownership).toBe("owned");
      expect(replacedListener.health).toBe("running");
    } finally {
      await close(listener).catch(() => undefined);
      rmSync(temporary, { force: true, recursive: true });
    }
  });

  it("stops a shared instance with its captured Start environment", async () => {
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-shared-stop-")
    );
    const repository = pathModule.join(temporary, "project");
    const featureWorktree = pathModule.join(temporary, "project-feature");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let featureId = "";
    try {
      git(repository, "init", "-q");
      git(repository, "config", "user.email", "branchbase@example.test");
      git(repository, "config", "user.name", "BranchBase Test");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          version: 1,
          setup: { argv: ["true"] },
          appGroups: {
            Apps: {
              start: { argv: ["true"] },
              stop: "process",
              apps: { Web: { protocol: "http" } },
            },
            Services: {
              instances: { mode: "selectable" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:net').createServer().listen(Number(process.env.DB_PORT),'127.0.0.1')",
                ],
              },
              stop: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:fs').writeFileSync('stopped-with-port.txt',process.env.PRODUCT_PORT)",
                ],
              },
              env: {
                DB_PORT: "{apps.Database.port}",
                PRODUCT_PORT: "{appGroups.Apps.apps.Web.port}",
              },
              apps: { Database: { protocol: "tcp" } },
            },
          },
        })
      );
      git(repository, "add", ".branchbase.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      controller = new TrustedWorkspaceController(undefined, {
        routing: inMemoryRoutingEngine(),
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      const initial = controller.inspect(repository);
      const main = initial.worktrees.find((worktree) => worktree.isMain);
      const feature = initial.worktrees.find((worktree) => !worktree.isMain);
      featureId = feature?.id ?? "";

      await controller.startAppGroup(repository, main?.id ?? "", "Services");
      const mainProductPort = controller
        .inspect(repository)
        .worktrees.find((worktree) => worktree.isMain)
        ?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      expect(mainProductPort).toBeNumber();

      await controller.stopAppGroup(repository, featureId, "Services");
      expect(
        readFileSync(
          pathModule.join(repository, "stopped-with-port.txt"),
          "utf-8"
        )
      ).toBe(String(mainProductPort));
    } finally {
      if (controller && featureId) {
        await controller
          .stopAppGroup(repository, featureId, "Services")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
    }
  }, 15_000);
});
