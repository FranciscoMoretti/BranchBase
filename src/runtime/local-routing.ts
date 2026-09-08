import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import pathModule from "node:path";

import { z } from "zod";

import { processIsLive } from "../host/process-inspection";
import { delay } from "./async-utils";
import {
  isPortlessProxyResponding,
  isPublishedPortlessRoute,
  observePortlessRoute,
  PORTLESS_PROXY_PROBE_HOSTNAME,
} from "./portless-observation";

export interface LocalRoute {
  hostname: string;
  port: number;
}

export type LocalRouteState =
  | "active"
  | "conflict"
  | "inactive"
  | "unavailable";

export interface LocalRoutingEngine {
  activate: (route: LocalRoute) => Promise<void>;
  deactivate: (route: LocalRoute) => Promise<void>;
  observe: (route: LocalRoute) => LocalRouteState;
  prepare?: () => Promise<void>;
  url: (hostname: string) => string;
}

const PortlessRouteSchema = z.strictObject({
  hostname: z.string().min(1),
  ngrokPid: z.number().int().positive().optional(),
  ngrokUrl: z.string().min(1).optional(),
  pid: z.number().int().nonnegative(),
  port: z.number().int().min(1).max(65_535),
  tailscaleFunnel: z.boolean().optional(),
  tailscaleHttpsPort: z.number().int().min(1).max(65_535).optional(),
  tailscaleUrl: z.string().min(1).optional(),
});
const PortlessRoutesSchema = z.array(PortlessRouteSchema);
type PortlessRoute = z.infer<typeof PortlessRouteSchema>;

const require = createRequire(import.meta.url);
const DEFAULT_PROXY_PORT = 1355;
const OBSERVATION_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

const packageFile = (packageName: string, ...parts: string[]): string =>
  pathModule.join(
    pathModule.dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );

const routeName = (hostname: string): string =>
  hostname.endsWith(".localhost")
    ? hostname.slice(0, -".localhost".length)
    : hostname;

const waitUntil = async (
  condition: () => Promise<boolean>,
  message: string
): Promise<void> => {
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Route activation polling observes each attempt before waiting.
    if (await condition()) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Route activation polling observes each attempt before waiting.
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(message);
};

export class PortlessRoutingEngine implements LocalRoutingEngine {
  private readonly cliPath: string;
  private readonly nodePath: string;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: { port?: number; stateDirectory?: string } = {}) {
    this.cliPath = packageFile("portless", "dist", "cli.js");
    this.nodePath = packageFile("node", "bin", "node");
    this.port = options.port ?? DEFAULT_PROXY_PORT;
    this.stateDirectory =
      options.stateDirectory ??
      pathModule.join(homedir(), ".branchbase", "portless");
  }

  async activate(route: LocalRoute): Promise<void> {
    await this.ensureProxy();
    const current = this.route(route.hostname);
    if (current && current.port !== route.port) {
      throw new Error(
        `${route.hostname} is already routed to backing port ${current.port}`
      );
    }
    if (!current) {
      this.run(["alias", routeName(route.hostname), String(route.port)]);
    }
    await waitUntil(async () => {
      if (this.route(route.hostname)?.port !== route.port) {
        return false;
      }
      const pid = this.proxyPid();
      if (pid === null || !processIsLive(pid)) {
        return false;
      }
      return await isPublishedPortlessRoute(
        this.url(route.hostname),
        this.url(PORTLESS_PROXY_PROBE_HOSTNAME)
      );
    }, `Portless did not activate ${route.hostname}`);
  }

  async prepare(): Promise<void> {
    await this.ensureProxy();
  }

  async deactivate(route: LocalRoute): Promise<void> {
    const current = this.route(route.hostname);
    if (!current) {
      return;
    }
    if (current.port !== route.port) {
      throw new Error(
        `Refusing to remove ${route.hostname}; it points to backing port ${current.port}`
      );
    }
    this.run(["alias", "--remove", routeName(route.hostname)]);
    await waitUntil(
      async () =>
        this.route(route.hostname) === null &&
        (await observePortlessRoute(this.url(route.hostname))) ===
          "unregistered",
      `Portless did not deactivate ${route.hostname}`
    );
  }

  observe(route: LocalRoute): LocalRouteState {
    const current = this.route(route.hostname);
    if (!current) {
      return "inactive";
    }
    if (current.port !== route.port) {
      return "conflict";
    }
    const pid = this.proxyPid();
    return pid !== null && processIsLive(pid) ? "active" : "unavailable";
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private async ensureProxy(): Promise<void> {
    const pid = this.proxyPid();
    if (pid !== null && processIsLive(pid)) {
      return;
    }
    this.run(["proxy", "start", "--port", String(this.port), "--no-tls"]);
    await waitUntil(
      () =>
        Promise.resolve(
          isPortlessProxyResponding(this.url(PORTLESS_PROXY_PROBE_HOSTNAME))
        ),
      `Portless proxy did not start on port ${this.port}`
    );
  }

  private environment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PORTLESS_HTTPS: "0",
      PORTLESS_PORT: String(this.port),
      PORTLESS_STATE_DIR: this.stateDirectory,
      PORTLESS_SYNC_HOSTS: "0",
      PORTLESS_TLD: "localhost",
    };
  }

  private proxyPid(): number | null {
    const path = pathModule.join(this.stateDirectory, "proxy.pid");
    if (!existsSync(path)) {
      return null;
    }
    const pid = Number(readFileSync(path, "utf-8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }

  private route(hostname: string): PortlessRoute | null {
    const path = pathModule.join(this.stateDirectory, "routes.json");
    if (!existsSync(path)) {
      return null;
    }
    try {
      const routes = PortlessRoutesSchema.parse(
        JSON.parse(readFileSync(path, "utf-8"))
      );
      return routes.find((route) => route.hostname === hostname) ?? null;
    } catch {
      throw new Error("Portless route state is invalid");
    }
  }

  private run(args: string[]): void {
    const result = spawnSync(this.nodePath, [this.cliPath, ...args], {
      encoding: "utf-8",
      env: this.environment(),
      timeout: 10_000,
    });
    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || "Portless command failed").trim()
      );
    }
  }
}
