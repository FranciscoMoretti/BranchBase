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
import type { LocalRoute, LocalRoutingEngine } from "../runtime/local-routing";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { AppGroupRuntime } from "./app-group-runtime";
import { WorkspaceController } from "./workspace-controller";

class InMemoryRoutingEngine implements LocalRoutingEngine {
  private readonly routes = new Map<string, number>();
  prepared = false;

  activate(route: LocalRoute): Promise<void> {
    if (!this.prepared) {
      throw new Error("Routing activated before preflight");
    }
    this.routes.set(route.hostname, route.port);
    return Promise.resolve();
  }

  deactivate(route: LocalRoute): Promise<void> {
    this.routes.delete(route.hostname);
    return Promise.resolve();
  }

  observe(route: LocalRoute) {
    const port = this.routes.get(route.hostname);
    if (port === undefined) {
      return "inactive" as const;
    }
    return port === route.port ? ("active" as const) : ("conflict" as const);
  }

  prepare(): Promise<void> {
    this.prepared = true;
    return Promise.resolve();
  }

  point(hostname: string, port: number): void {
    this.routes.set(hostname, port);
  }

  url(hostname: string): string {
    return `http://${hostname}:1355`;
  }
}

class FailingPrepareRoutingEngine extends InMemoryRoutingEngine {
  override prepare(): Promise<void> {
    return Promise.reject(new Error("Portless unavailable"));
  }
}

class BlockingPrepareRoutingEngine extends InMemoryRoutingEngine {
  private released = false;
  private releasePrepare: (() => void) | null = null;

  override prepare(): Promise<void> {
    if (this.released) {
      this.prepared = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.releasePrepare = resolve;
    });
  }

  release(): void {
    this.released = true;
    this.prepared = true;
    this.releasePrepare?.();
  }
}

class RecoverableActivationRoutingEngine extends InMemoryRoutingEngine {
  private failing = true;

  override activate(route: LocalRoute): Promise<void> {
    return this.failing
      ? Promise.reject(new Error("Portless route activation failed"))
      : super.activate(route);
  }

  recover(): void {
    this.failing = false;
  }
}

class TrustedWorkspaceController extends WorkspaceController {
  override assertTrusted(): void {
    // This fixture controls every command and does not touch repository trust.
  }

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

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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
        new InMemoryRoutingEngine(),
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
      const routing = new BlockingPrepareRoutingEngine();
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
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-instances-")
    );
    const repository = pathModule.join(temporary, "project");
    const featureWorktree = pathModule.join(temporary, "project-feature");
    mkdirSync(repository);
    try {
      git(repository, "init", "-q");
      git(repository, "config", "user.email", "branchbase@example.test");
      git(repository, "config", "user.name", "BranchBase Test");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          appGroups: {
            Apps: {
              apps: { Web: { protocol: "http" } },
              start: { argv: ["true"] },
              stop: "process",
            },
            Services: {
              apps: { Database: { protocol: "tcp" } },
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      git(repository, "add", ".branchbase.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      const controller = new WorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      const initial = controller.inspect(repository);
      const main = initial.worktrees.find((worktree) => worktree.isMain);
      const feature = initial.worktrees.find((worktree) => !worktree.isMain);
      expect(main).toBeDefined();
      expect(feature).toBeDefined();

      const mainApps = main?.appGroups.find((group) => group.id === "Apps");
      const featureApps = feature?.appGroups.find(
        (group) => group.id === "Apps"
      );
      expect(mainApps?.instance.mode).toBe("per-worktree");
      expect(mainApps?.instance.id).not.toBe(featureApps?.instance.id);

      const mainServices = main?.appGroups.find(
        (group) => group.id === "Services"
      );
      const featureServices = feature?.appGroups.find(
        (group) => group.id === "Services"
      );
      expect(mainServices?.instance.name).toBe("Default");
      expect(mainServices?.instance.id).toBe(featureServices?.instance.id);

      controller.createAppGroupInstance(
        repository,
        feature?.id ?? "",
        "Services",
        "Migration experiment"
      );
      const isolated = controller.inspect(repository);
      const isolatedMain = isolated.worktrees
        .find((worktree) => worktree.isMain)
        ?.appGroups.find((group) => group.id === "Services");
      const isolatedFeature = isolated.worktrees
        .find((worktree) => !worktree.isMain)
        ?.appGroups.find((group) => group.id === "Services");

      expect(isolatedMain?.instance.name).toBe("Default");
      expect(isolatedFeature?.instance.name).toBe("Migration experiment");
      expect(
        isolatedFeature?.instances.map((instance) => instance.name)
      ).toEqual(["Default", "Migration experiment"]);

      controller.selectAppGroupInstance(
        repository,
        feature?.id ?? "",
        "Services",
        isolatedMain?.instance.id ?? ""
      );
      const sharedAgain = controller.inspect(repository);
      expect(
        sharedAgain.worktrees
          .find((worktree) => !worktree.isMain)
          ?.appGroups.find((group) => group.id === "Services")?.instance.id
      ).toBe(isolatedMain?.instance.id);
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
          appGroups: {
            Services: {
              apps: { Service: { protocol: "tcp" } },
              env: { SERVICE_PORT: "{apps.Service.port}" },
              instances: { mode: "selectable" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:net').createServer().listen(Number(process.env.SERVICE_PORT),'127.0.0.1')",
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
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
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
    const temporary = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-runtime-")
    );
    const repository = pathModule.join(temporary, "project");
    mkdirSync(repository);
    let controller: WorkspaceController | null = null;
    let worktreeId = "";
    let blocker: Server | null = null;
    try {
      git(repository, "init", "-q");
      writeFileSync(
        pathModule.join(repository, ".branchbase.json"),
        JSON.stringify({
          appGroups: {
            Apps: {
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
              env: {
                DATABASE_PORT: "{appGroups.Services.apps.Database.port}",
                SLOW_PORT: "{apps.Slow.port}",
                WEB_PORT: "{apps.Web.port}",
              },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');const http=require('node:http');fs.writeFileSync('resolved-env.txt',process.env.DATABASE_PORT+'\\n'+process.env.WEB_PORT);http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
            },
            Services: {
              apps: { Database: { protocol: "tcp" } },
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const routing = new InMemoryRoutingEngine();
      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing,
        state: new FileBranchBaseStateStore(
          pathModule.join(temporary, "state.json")
        ),
      });
      worktreeId = controller.inspect(repository).worktrees[0]?.id ?? "";

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(routing.prepared).toBe(true);
      const running = controller.inspect(repository).worktrees[0];
      const apps = running?.appGroups.find((group) => group.id === "Apps");
      const services = running?.appGroups.find(
        (group) => group.id === "Services"
      );
      expect(apps?.run).toEqual({
        startedAt: expect.any(String),
        worktreePath: running?.path,
      });
      if (!services) {
        throw new Error("Missing Services snapshot");
      }
      expect(apps?.dependencies).toEqual([
        {
          groupId: "Services",
          instanceId: services.instance.id,
          name: services.instance.name,
        },
      ]);
      expect(
        running?.appGroups.find((group) => group.id === "Apps")?.health
      ).toBe("partially-running");
      const webPort = running?.appGroups
        .find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      const databasePort = running?.appGroups
        .find((group) => group.id === "Services")
        ?.apps.find((app) => app.id === "Database")?.port;
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
      const stoppedPort = controller
        .inspect(repository)
        .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
        ?.apps.find((app) => app.id === "Web")?.port;
      expect(stoppedPort).toBe(webPort);

      expect(
        await controller.startAppGroup(repository, worktreeId, "Apps")
      ).toBe("started");
      expect(
        controller
          .inspect(repository)
          .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
          ?.apps.find((app) => app.id === "Web")?.port
      ).toBe(webPort);

      const webHostname = new URL(
        controller
          .inspect(repository)
          .worktrees[0]?.appGroups.find((group) => group.id === "Apps")
          ?.apps.find((app) => app.id === "Web")?.url ?? ""
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
      if (blocker) {
        await close(blocker).catch(() => undefined);
      }
      if (controller && worktreeId) {
        await controller
          .stopAppGroup(repository, worktreeId, "Apps")
          .catch(() => undefined);
      }
      rmSync(temporary, { force: true, recursive: true });
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
          appGroups: {
            Apps: {
              apps: { Web: { protocol: "http" } },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:fs').writeFileSync('started.txt','yes')",
                ],
              },
              stop: "process",
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new FailingPrepareRoutingEngine(),
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
          appGroups: {
            Apps: {
              apps: { Api: { protocol: "tcp" } },
              start: { argv: [`missing-branchbase-command-${process.pid}`] },
              stop: "process",
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
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
          appGroups: {
            Apps: {
              apps: { Web: { protocol: "http" } },
              env: { WEB_PORT: "{apps.Web.port}" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "require('node:http').createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const routing = new RecoverableActivationRoutingEngine();
      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing,
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
          appGroups: {
            Apps: {
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
              env: {
                DELAYED_PORT: "{apps.Delayed.port}",
                WEB_PORT: "{apps.Web.port}",
              },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');const http=require('node:http');http.createServer((_request,response)=>response.end('ok')).listen(Number(process.env.WEB_PORT),'127.0.0.1');http.createServer((_request,response)=>(response.statusCode=fs.existsSync('delayed-ready')?200:503,response.end('status'))).listen(Number(process.env.DELAYED_PORT),'127.0.0.1')",
                ],
              },
              stop: "process",
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
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
          appGroups: {
            Services: {
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
              env: { SERVICE_PORT: "{apps.Service.port}" },
              start: {
                argv: [
                  "bun",
                  "-e",
                  "const fs=require('node:fs');fs.writeFileSync('start-count',String(Number(fs.existsSync('start-count')?fs.readFileSync('start-count','utf8'):0)+1));require('node:http').createServer((_request,response)=>(response.statusCode=fs.existsSync('service-ready')?200:503,response.end('status'))).listen(Number(process.env.SERVICE_PORT),'127.0.0.1')",
                ],
              },
              stop: { argv: ["true"] },
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
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
          appGroups: {
            Services: {
              apps: { Database: { protocol: "tcp" } },
              instances: { mode: "selectable" },
              start: { argv: ["true"] },
              stop: { argv: ["true"] },
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const state = new FileBranchBaseStateStore(
        pathModule.join(temporary, "state.json")
      );
      const controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
        state,
      });
      const initial = controller.inspect(repository);
      const worktree = initial.worktrees[0];
      const group = worktree?.appGroups[0];
      expect(group).toBeDefined();
      await listen(listener, 0);
      const address = listener.address();
      if (!address || typeof address === "string") {
        throw new Error("Test listener did not expose a TCP port");
      }
      const key = {
        instanceId: group?.instance.id ?? "",
        repoPath: initial.repoPath,
      };
      state.assignEndpointPort(key, "Database", address.port);
      state.saveRun(key, {
        apps: {
          Database: {
            appId: "Database",
            host: "127.0.0.1",
            port: address.port,
            protocol: "tcp",
          },
        },
        createdAt: new Date().toISOString(),
        groupId: "Services",
        instanceId: key.instanceId,
        instanceIdsByGroup: { Services: key.instanceId },
        worktreePath: worktree?.path ?? repository,
      });

      const inspected =
        controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(inspected?.apps[0]?.listening).toBe(false);
      expect(inspected?.apps[0]?.ownership).toBe("foreign");
      expect(inspected?.apps[0]?.readiness).toBe("unready");
      expect(inspected?.health).toBe("not-running");
      expect(inspected?.instances[0]?.running).toBe(false);

      const claimedRun = state.run(key);
      expect(claimedRun).not.toBeNull();
      if (!claimedRun) {
        throw new Error("Expected a persisted App-group run");
      }
      const database = claimedRun.apps.Database;
      if (!database) {
        throw new Error("Expected a persisted Database endpoint");
      }
      database.listenerClaimed = true;
      state.saveRun(key, claimedRun);

      const replacedListener =
        controller.inspect(repository).worktrees[0]?.appGroups[0];
      expect(replacedListener?.apps[0]?.listening).toBe(true);
      expect(replacedListener?.apps[0]?.ownership).toBe("owned");
      expect(replacedListener?.health).toBe("running");
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
          appGroups: {
            Apps: {
              apps: { Web: { protocol: "http" } },
              start: { argv: ["true"] },
              stop: "process",
            },
            Services: {
              apps: { Database: { protocol: "tcp" } },
              env: {
                DB_PORT: "{apps.Database.port}",
                PRODUCT_PORT: "{appGroups.Apps.apps.Web.port}",
              },
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
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      git(repository, "add", ".branchbase.json");
      git(repository, "commit", "-qm", "test config");
      git(repository, "worktree", "add", "-qb", "feature", featureWorktree);

      controller = new TrustedWorkspaceController(undefined, {
        processes: new ProcessSupervisor(pathModule.join(temporary, "control")),
        routing: new InMemoryRoutingEngine(),
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
