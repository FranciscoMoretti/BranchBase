import { test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import pathModule from "node:path";

import { repositoryCommandFingerprint } from "../config/repository-trust";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import {
  assert,
  endpoint,
  integrationConfig,
  PortlessIntegrationFixture,
  processIsLive,
  waitUntil,
} from "./portless-fixture";

const listen = async (server: Server): Promise<void> => {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
};

const close = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return;
  }
  const closed = once(server, "close");
  server.close();
  await closed;
};

test("serializes concurrent lifecycle requests and scopes trust to the fixture", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  try {
    assert(
      existsSync(
        pathModule.join(fixture.controlDirectory, "trusted-repositories.json")
      ),
      "Fixture trust was not written to its isolated control directory"
    );
    const main = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(main, "Main worktree disappeared");
    const results = await Promise.all([
      fixture.controller.startAppGroup(fixture.root, main.id, "development"),
      fixture.controller.startAppGroup(fixture.root, main.id, "development"),
    ]);
    assert(
      results.filter((result) => result === "started").length === 1 &&
        results.filter((result) => result === "already-running").length === 1,
      "Concurrent Start requests did not share one lifecycle result"
    );
    const [restartResult, stopResult] = await Promise.all([
      fixture.controller.startAppGroup(fixture.root, main.id, "development"),
      fixture.controller.stopAppGroup(fixture.root, main.id, "development"),
    ]);
    assert(
      restartResult === "already-running" && stopResult === "stopped",
      "Concurrent Start and Stop requests did not run in call order"
    );
  } finally {
    await fixture.cleanup();
  }
}, 120_000);

test("isolates routes, environments, logs, and stable URLs across worktrees", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  try {
    const before = fixture.controller.inspect(fixture.root);
    assert(
      before.worktrees.length === 3,
      "Git worktrees were not all discovered"
    );
    assert(
      before.worktrees.every((worktree) =>
        worktree.appGroups.every((group) =>
          group.apps.every((app) => !(app.open || app.port || app.url))
        )
      ),
      "A route or Backing endpoint was exposed before Start"
    );

    await Promise.all(
      before.worktrees.map((worktree) =>
        fixture.controller.startAppGroup(
          fixture.root,
          worktree.id,
          "development"
        )
      )
    );

    const running = fixture.controller.inspect(fixture.root);
    const ports = new Set<number>();
    const urls = new Set<string>();
    const worktreePaths = running.worktrees.map((worktree) => worktree.path);
    for (const worktree of running.worktrees) {
      const api = endpoint(worktree, "api");
      const site = endpoint(worktree, "site");
      assert(
        api.open && api.port && api.url,
        `API did not open for ${worktree.path}`
      );
      assert(
        site.open && site.port && site.url,
        `Site did not open for ${worktree.path}`
      );
      // oxlint-disable-next-line no-await-in-loop -- Endpoint assertions keep each worktree batch together while sharing collision sets.
      await Promise.all(
        [api, site].map(async (app) => {
          assert(!ports.has(app.port as number), "Backing ports collided");
          assert(!urls.has(app.url as string), "Friendly URLs collided");
          ports.add(app.port as number);
          urls.add(app.url as string);
          const response = await fetch(app.url as string);
          const body = (await response.json()) as {
            app?: string;
            environment?: Record<string, string>;
          };
          assert(
            response.ok && body.app === app.id,
            `${app.id} routed incorrectly`
          );
          assert(
            body.environment?.API_PORT === String(api.port) &&
              body.environment.API_URL === api.url &&
              body.environment.API_DIRECT_URL === api.directUrl &&
              body.environment.SITE_PORT === String(site.port) &&
              body.environment.SITE_URL === site.url &&
              body.environment.SITE_DIRECT_URL === site.directUrl,
            `${worktree.path} received an incomplete Repository environment`
          );
        })
      );
      const logs = fixture.controller
        .logs(fixture.root, worktree.id, "development")
        .join("\n");
      assert(
        logs.includes(worktree.path) &&
          worktreePaths
            .filter((path) => path !== worktree.path)
            .every((path) => !logs.includes(path)),
        `Logs were not isolated for ${worktree.path}`
      );
    }
    assert(
      ports.size === 6 && urls.size === 6,
      "Expected six independent endpoints"
    );

    const linked = running.worktrees.find(
      (worktree) => worktree.path === fixture.linkedPath
    );
    assert(linked, "Linked worktree disappeared");
    const linkedUrls = Object.fromEntries(
      linked.appGroups[0]?.apps.map((app) => [app.id, app.url as string]) ?? []
    );
    await fixture.controller.stopAppGroup(
      fixture.root,
      linked.id,
      "development"
    );
    const afterStop = fixture.controller.inspect(fixture.root);
    const stoppedLinked = afterStop.worktrees.find(
      (worktree) => worktree.path === fixture.linkedPath
    );
    assert(
      stoppedLinked?.appGroups[0]?.apps.every(
        (app) => !app.open && app.port !== null && app.url === null
      ),
      "Stopping one worktree did not retain only its stable endpoint assignments"
    );
    await Promise.all(
      Object.values(linkedUrls).map(async (url) => {
        const response = await fetch(url);
        assert(
          response.status === 404,
          "A stopped worktree route remained active"
        );
      })
    );

    fixture.rebuildController();
    await fixture.controller.startAppGroup(
      fixture.root,
      linked.id,
      "development"
    );
    const restartedLinked = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.path === fixture.linkedPath);
    assert(
      restartedLinked?.appGroups[0]?.apps.every(
        (app) => app.url === linkedUrls[app.id]
      ),
      "Friendly URLs changed after controller reconstruction and restart"
    );
    await fixture.controller.stopAppGroup(
      fixture.root,
      linked.id,
      "development"
    );
    await Promise.all(
      afterStop.worktrees
        .filter((item) => item.path !== fixture.linkedPath)
        .flatMap((worktree) => worktree.appGroups[0]?.apps ?? [])
        .map(async (app) => {
          const { url } = app;
          assert(url, "Stopping one worktree affected another");
          const response = await fetch(url);
          assert(response.ok, "Stopping one worktree affected another");
        })
    );
  } finally {
    await fixture.cleanup();
  }
}, 120_000);

test("re-adopts a surviving process and recovers routes after a proxy crash", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  let recoveryHarness: ReturnType<typeof spawn> | null = null;
  try {
    const main = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(main, "Main worktree disappeared");
    const branchbaseRoot = pathModule.dirname(
      pathModule.dirname(import.meta.dir)
    );
    const harnessPath = pathModule.join(fixture.sandbox, "recovery-harness.ts");
    const readyMarker = pathModule.join(fixture.sandbox, "recovery-ready.json");
    writeFileSync(
      harnessPath,
      `const { CodexHookActivityStore } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/codex/codex-hook-activity.ts"))});
const { UnavailableCodexIntegrationAdapter } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/codex/codex-integration.ts"))});
const { WorkspaceController } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/controller/workspace-controller.ts"))});
const { PortlessRoutingEngine } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/runtime/local-routing.ts"))});
const { FileBranchBaseStateStore } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/runtime/local-state.ts"))});
const { ProcessSupervisor } = await import(${JSON.stringify(pathModule.join(branchbaseRoot, "src/runtime/process-supervisor.ts"))});
const { writeFileSync } = await import("node:fs");
const controller = new WorkspaceController(new UnavailableCodexIntegrationAdapter(), {
  codexHooks: new CodexHookActivityStore({ persist: false }),
  processes: new ProcessSupervisor(${JSON.stringify(fixture.controlDirectory)}),
  routing: new PortlessRoutingEngine({ port: ${fixture.proxyPort}, stateDirectory: ${JSON.stringify(fixture.portlessState)} }),
  state: new FileBranchBaseStateStore(${JSON.stringify(fixture.statePath)}),
});
const worktree = controller.inspect(${JSON.stringify(fixture.root)}).worktrees.find((item) => item.isMain);
if (!worktree) throw new Error("Main worktree disappeared");
await controller.startAppGroup(${JSON.stringify(fixture.root)}, worktree.id, "development");
writeFileSync(${JSON.stringify(readyMarker)}, JSON.stringify(controller.inspect(${JSON.stringify(fixture.root)}).globalProcesses));
setInterval(() => {}, 1000);
`
    );
    recoveryHarness = spawn(process.execPath, [harnessPath], {
      env: process.env,
      stdio: "ignore",
    });
    assert(recoveryHarness.pid, "Recovery harness did not start");
    const harnessPid = recoveryHarness.pid;
    await waitUntil(
      () => existsSync(readyMarker),
      "Recovery harness did not start the App group",
      20_000
    );
    const harnessProcesses = JSON.parse(readFileSync(readyMarker, "utf-8")) as {
      cwd: string;
      pid: number;
    }[];
    const survivingPid = harnessProcesses.find(
      (item) => item.cwd === fixture.root
    )?.pid;
    assert(survivingPid, "Recovery harness did not record the managed process");
    process.kill(harnessPid, "SIGKILL");
    await waitUntil(
      () => !processIsLive(harnessPid),
      "Recovery harness did not stop"
    );
    recoveryHarness = null;
    assert(
      processIsLive(survivingPid),
      "Managed App did not survive daemon exit"
    );

    fixture.rebuildController();
    const adopted = fixture.controller.inspect(fixture.root);
    const adoptedGroup = adopted.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      adoptedGroup?.apps.every((app) => app.open) &&
        adopted.globalProcesses.some((item) => item.pid === survivingPid),
      "A surviving managed process was not re-adopted"
    );
    await fixture.controller.stopAppGroup(fixture.root, main.id, "development");

    await fixture.controller.startAppGroup(
      fixture.root,
      main.id,
      "development"
    );
    const beforeCrash = fixture.controller.inspect(fixture.root);
    const beforeCrashGroup = beforeCrash.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    const processBeforeRecovery = beforeCrash.globalProcesses.find(
      (item) => item.cwd === fixture.root
    )?.pid;
    const urlsBeforeRecovery = Object.fromEntries(
      beforeCrashGroup?.apps.map((app) => [app.id, app.url]) ?? []
    );
    const proxyPid = Number(
      readFileSync(
        pathModule.join(fixture.portlessState, "proxy.pid"),
        "utf-8"
      ).trim()
    );
    process.kill(proxyPid, "SIGTERM");
    await waitUntil(
      () => !processIsLive(proxyPid),
      "Portless proxy did not stop"
    );
    const unavailable = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      unavailable?.apps.every((app) => app.routeState === "unavailable"),
      "A stopped Portless proxy was not observed as unavailable"
    );
    await fixture.controller.retryAppGroup(
      fixture.root,
      main.id,
      "development"
    );
    const recovered = fixture.controller.inspect(fixture.root);
    const recoveredGroup = recovered.worktrees
      .find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "development");
    assert(
      recoveredGroup?.apps.every(
        (app) => app.open && app.url === urlsBeforeRecovery[app.id]
      ) &&
        recovered.globalProcesses.find((item) => item.cwd === fixture.root)
          ?.pid === processBeforeRecovery,
      "Route retry did not preserve the process and Friendly URLs"
    );
  } finally {
    if (recoveryHarness?.pid && processIsLive(recoveryHarness.pid)) {
      process.kill(recoveryHarness.pid, "SIGKILL");
    }
    await fixture.cleanup();
  }
}, 120_000);

test("runs a configured Stop command for an external runtime", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  try {
    const main = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(main, "Main worktree disappeared");
    await fixture.controller.startAppGroup(fixture.root, main.id, "external");
    const external = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain)
      ?.appGroups.find((group) => group.id === "external")?.apps[0];
    const externalUrl = external?.url;
    const externalResponse = externalUrl ? await fetch(externalUrl) : null;
    assert(
      external?.open && externalUrl && externalResponse?.ok,
      "Configured-command App group did not start"
    );
    await fixture.controller.stopAppGroup(fixture.root, main.id, "external");
    assert(
      existsSync(pathModule.join(fixture.root, "integration-command-stopped")),
      "Configured Stop command did not run"
    );
  } finally {
    await fixture.cleanup();
  }
}, 120_000);

test("rejects and preserves a foreign Friendly URL route", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  const conflictServer = createServer((socket) => {
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\nConnection: close\r\n\r\nforeign route"
    );
  });
  let conflictRoute: { hostname: string; port: number } | null = null;
  try {
    await listen(conflictServer);
    const address = conflictServer.address();
    assert(
      address && typeof address !== "string",
      "Could not allocate conflict port"
    );
    const main = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(main, "Main worktree disappeared");
    const state = new FileBranchBaseStateStore(fixture.statePath);
    const instance = state.instance({
      configFingerprint: repositoryCommandFingerprint(integrationConfig),
      groupId: "development",
      mode: "per-worktree",
      repoLabel: "repo",
      repoPath: fixture.root,
      worktreeLabel: main.branch,
      worktreePath: main.path,
    });
    const assignment = state.endpoint({
      appId: "site",
      appLabel: "site",
      groupId: "development",
      instanceId: instance.id,
      repoPath: fixture.root,
    });
    conflictRoute = { hostname: assignment.hostname, port: address.port };
    await fixture.routing.activate(conflictRoute);
    let conflictRejected = false;
    try {
      await fixture.controller.startAppGroup(
        fixture.root,
        main.id,
        "development"
      );
    } catch (error) {
      conflictRejected =
        error instanceof Error && error.message.includes("already routed");
    }
    assert(
      conflictRejected,
      "A foreign Friendly URL conflict was not rejected"
    );
    const conflicted = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(
      conflicted?.appGroups[0]?.apps.every((app) => !(app.open || app.url)),
      "A partial set of Friendly URLs was published after a route conflict"
    );
    let stopConflictRejected = false;
    try {
      await fixture.controller.stopAppGroup(
        fixture.root,
        main.id,
        "development"
      );
    } catch (error) {
      stopConflictRejected =
        error instanceof Error &&
        error.message.includes("points to a different Backing endpoint");
    }
    assert(
      stopConflictRejected,
      "Stop did not report the foreign Friendly URL conflict"
    );
    assert(
      fixture.routing.observe(conflictRoute) === "active",
      "Stop removed a foreign Portless route"
    );
    await fixture.routing.deactivate(conflictRoute);
    conflictRoute = null;
    await fixture.controller.stopAppGroup(fixture.root, main.id, "development");
  } finally {
    if (conflictRoute) {
      await fixture.routing.deactivate(conflictRoute);
    }
    await close(conflictServer);
    await fixture.cleanup();
  }
}, 120_000);

test("preserves an existing Friendly URL when another route conflicts", async () => {
  const fixture = await PortlessIntegrationFixture.create();
  const conflictServer = createServer((socket) => {
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\nConnection: close\r\n\r\nforeign route"
    );
  });
  let conflictRoute: { hostname: string; port: number } | null = null;
  try {
    await listen(conflictServer);
    const address = conflictServer.address();
    assert(
      address && typeof address !== "string",
      "Could not allocate conflict port"
    );
    const main = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.isMain);
    assert(main, "Main worktree disappeared");
    await fixture.controller.startAppGroup(
      fixture.root,
      main.id,
      "development"
    );
    const development = fixture.controller
      .inspect(fixture.root)
      .worktrees.find((worktree) => worktree.id === main.id)
      ?.appGroups.find((group) => group.id === "development");
    assert(development, "Development app group disappeared");
    const run = new FileBranchBaseStateStore(fixture.statePath).run({
      instanceId: development.instance.id,
      repoPath: fixture.root,
    });
    const api = run?.apps.api;
    const site = run?.apps.site;
    assert(api?.hostname && site?.hostname, "HTTP routes were not allocated");
    const apiRoute = { hostname: api.hostname, port: api.port };
    const siteRoute = { hostname: site.hostname, port: site.port };
    await fixture.routing.deactivate(apiRoute);
    conflictRoute = { hostname: api.hostname, port: address.port };
    await fixture.routing.activate(conflictRoute);

    let conflictRejected = false;
    try {
      await fixture.controller.startAppGroup(
        fixture.root,
        main.id,
        "development"
      );
    } catch (error) {
      conflictRejected =
        error instanceof Error && error.message.includes("already routed");
    }
    assert(conflictRejected, "A foreign route conflict was not rejected");
    assert(
      fixture.routing.observe(siteRoute) === "active",
      "Route rollback removed a Friendly URL that Start did not create"
    );
    await fixture.routing.deactivate(conflictRoute);
    conflictRoute = null;
    await fixture.controller.stopAppGroup(fixture.root, main.id, "development");
  } finally {
    if (conflictRoute) {
      await fixture.routing.deactivate(conflictRoute);
    }
    await close(conflictServer);
    await fixture.cleanup();
  }
}, 120_000);
