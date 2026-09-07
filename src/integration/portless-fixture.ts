import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CodexHookActivityStore } from "../codex/codex-hook-activity";
import { UnavailableCodexIntegrationAdapter } from "../codex/codex-integration";
import type { BranchBaseConfig } from "../config/branchbase-schema";
import { WorkspaceController } from "../controller/workspace-controller";
import type { AppEndpointSnapshot } from "../controller/workspace-snapshot";
import { PortlessRoutingEngine } from "../runtime/local-routing";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { ProcessSupervisor } from "../runtime/process-supervisor";
import { reserveBackingPort } from "../runtime/readiness";

const require = createRequire(import.meta.url);

export const integrationConfig: BranchBaseConfig = {
  version: 1,
  setup: { argv: ["true"] },
  appGroups: {
    development: {
      instances: { mode: "per-worktree" },
      apps: {
        api: { protocol: "http", readiness: "tcp" },
        site: { protocol: "http", readiness: "tcp" },
      },
      env: {
        API_DIRECT_URL: "{apps.api.directUrl}",
        API_PORT: "{apps.api.port}",
        API_URL: "{apps.api.url}",
        SITE_DIRECT_URL: "{apps.site.directUrl}",
        SITE_PORT: "{apps.site.port}",
        SITE_URL: "{apps.site.url}",
      },
      start: { argv: [process.execPath, "integration-server.ts"] },
      stop: "process",
    },
    external: {
      instances: { mode: "per-worktree" },
      apps: {
        worker: { protocol: "http", readiness: "tcp" },
      },
      env: {
        WORKER_PORT: "{apps.worker.port}",
        WORKER_URL: "{apps.worker.url}",
      },
      start: { argv: [process.execPath, "integration-command-server.ts"] },
      stop: { argv: [process.execPath, "integration-command-stop.ts"] },
    },
  },
};

export function packageFile(packageName: string, ...parts: string[]): string {
  return join(
    dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function run(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitUntil(
  condition: () => boolean,
  message: string,
  timeout = 10_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

export function endpoint(
  worktree: ReturnType<WorkspaceController["inspect"]>["worktrees"][number],
  appId: string
): AppEndpointSnapshot {
  const value = worktree.appGroups[0]?.apps.find((app) => app.id === appId);
  assert(value, `${appId} was not present for ${worktree.path}`);
  return value;
}

export class PortlessIntegrationFixture {
  readonly controlDirectory: string;
  controller: WorkspaceController;
  readonly detachedPath: string;
  readonly linkedPath: string;
  readonly portlessState: string;
  readonly proxyPort: number;
  readonly root: string;
  readonly routing: PortlessRoutingEngine;
  readonly sandbox: string;
  readonly statePath: string;

  private constructor(input: { proxyPort: number; sandbox: string }) {
    this.sandbox = input.sandbox;
    this.root = join(this.sandbox, "repo");
    this.linkedPath = join(this.sandbox, "linked-worktree");
    this.detachedPath = join(this.sandbox, "detached-worktree");
    this.controlDirectory = join(this.sandbox, "control");
    this.portlessState = join(this.sandbox, "portless");
    this.statePath = join(this.sandbox, "state.json");
    this.proxyPort = input.proxyPort;
    this.routing = new PortlessRoutingEngine({
      port: this.proxyPort,
      stateDirectory: this.portlessState,
    });
    this.controller = this.createController();
  }

  static async create(): Promise<PortlessIntegrationFixture> {
    let lastFailure: unknown = new Error(
      "Could not allocate a Portless integration proxy"
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sandbox = realpathSync(
        mkdtempSync(join(tmpdir(), "branchbase-portless-integration-"))
      );
      const reservation = await reserveBackingPort();
      const proxyPort = reservation.port;
      await reservation.release();
      const fixture = new PortlessIntegrationFixture({ proxyPort, sandbox });
      try {
        await fixture.routing.prepare();
        fixture.initializeRepository();
        return fixture;
      } catch (error) {
        lastFailure = error;
        await fixture.cleanup();
      }
    }
    throw lastFailure;
  }

  rebuildController(): WorkspaceController {
    this.controller = this.createController();
    return this.controller;
  }

  async cleanup(): Promise<void> {
    try {
      for (const worktree of this.controller.inspect(this.root).worktrees) {
        for (const groupId of Object.keys(integrationConfig.appGroups)) {
          try {
            await this.controller.stopAppGroup(this.root, worktree.id, groupId);
          } catch {
            // Preserve the test failure while attempting the remaining cleanup.
          }
        }
      }
    } catch {
      // The repository may not have completed initialization.
    }
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(this.proxyPort),
          PORTLESS_STATE_DIR: this.portlessState,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    rmSync(this.sandbox, { force: true, recursive: true });
  }

  private createController(): WorkspaceController {
    return new WorkspaceController(new UnavailableCodexIntegrationAdapter(), {
      codexHooks: new CodexHookActivityStore({ persist: false }),
      processes: new ProcessSupervisor(this.controlDirectory),
      routing: this.routing,
      state: new FileBranchBaseStateStore(this.statePath),
    });
  }

  private initializeRepository(): void {
    run(this.sandbox, "git", ["init", "-q", this.root]);
    run(this.root, "git", ["config", "user.email", "test@branchbase.local"]);
    run(this.root, "git", [
      "config",
      "user.name",
      "BranchBase Integration Test",
    ]);
    writeFileSync(
      join(this.root, ".branchbase.json"),
      `${JSON.stringify(integrationConfig, null, 2)}\n`
    );
    writeFileSync(
      join(this.root, "integration-server.ts"),
      `const environment = {
  API_DIRECT_URL: process.env.API_DIRECT_URL,
  API_PORT: process.env.API_PORT,
  API_URL: process.env.API_URL,
  SITE_DIRECT_URL: process.env.SITE_DIRECT_URL,
  SITE_PORT: process.env.SITE_PORT,
  SITE_URL: process.env.SITE_URL,
  cwd: process.cwd(),
};
for (const app of ["api", "site"] as const) {
  Bun.serve({
    hostname: "127.0.0.1",
    port: Number(environment[app === "api" ? "API_PORT" : "SITE_PORT"]),
    fetch() { return Response.json({ app, environment }); },
  });
}
console.log(JSON.stringify(environment));
`
    );
    writeFileSync(
      join(this.root, "integration-command-server.ts"),
      `import { writeFileSync } from "node:fs";
writeFileSync("integration-command.pid", String(process.pid));
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.WORKER_PORT),
  fetch() { return Response.json({ url: process.env.WORKER_URL }); },
});
`
    );
    writeFileSync(
      join(this.root, "integration-command-stop.ts"),
      `import { readFileSync, writeFileSync } from "node:fs";
const pid = Number(readFileSync("integration-command.pid", "utf8"));
process.kill(pid, "SIGTERM");
writeFileSync("integration-command-stopped", String(pid));
`
    );
    run(this.root, "git", ["add", "."]);
    run(this.root, "git", ["commit", "-qm", "integration fixture"]);
    run(this.root, "git", [
      "worktree",
      "add",
      "-qb",
      "integration-linked",
      this.linkedPath,
    ]);
    run(this.root, "git", [
      "worktree",
      "add",
      "-q",
      "--detach",
      this.detachedPath,
      "HEAD",
    ]);
    this.controller.trustRepository(this.root);
  }
}
