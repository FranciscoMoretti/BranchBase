import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import pathModule from "node:path";

import { RouteStore } from "portless";
import { z } from "zod";

import { pollUntil } from "../host/polling";
import { processIsLive, processStartMarker } from "../host/process-inspection";
import {
  isPortlessProxyResponding,
  isPublishedPortlessRoute,
  observePortlessRoute,
  PORTLESS_PROXY_PROBE_HOSTNAME,
} from "./observation";
import { startProxyProcess } from "./proxy-process";

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

const packageFile = (packageName: string, ...parts: string[]): string =>
  pathModule.join(
    pathModule.dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );

const operations = new Map<string, Promise<unknown>>();

const serialize = <T>(
  directory: string,
  operation: () => Promise<T>
): Promise<T> => {
  const previous = operations.get(directory) ?? Promise.resolve();
  const result = (async () => {
    try {
      await previous;
    } catch {
      // A failed operation must not poison later mutations.
    }
    return operation();
  })();
  operations.set(directory, result);
  void (async () => {
    try {
      await result;
    } catch {
      // The caller receives the original rejection.
    } finally {
      if (operations.get(directory) === result) {
        operations.delete(directory);
      }
    }
  })();
  return result;
};

export class PortlessRoutingEngine implements LocalRoutingEngine {
  private readonly nodePath: string;
  private readonly store: RouteStore;
  readonly port: number;
  readonly stateDirectory: string;

  constructor(options: { port?: number; stateDirectory?: string } = {}) {
    this.nodePath = packageFile("node", "bin", "node");
    this.port = options.port ?? DEFAULT_PROXY_PORT;
    this.stateDirectory = pathModule.resolve(
      options.stateDirectory ??
        pathModule.join(homedir(), ".branchbase", "portless")
    );
    this.store = new RouteStore(this.stateDirectory);
  }

  activate(route: LocalRoute): Promise<void> {
    return serialize(this.stateDirectory, async () => {
      await this.ensureProxy();
      const current = this.route(route.hostname);
      if (current && current.port !== route.port) {
        throw new Error(
          `${route.hostname} is already routed to backing port ${current.port}`
        );
      }
      if (!current) {
        this.store.addRoute(route.hostname, route.port, 0);
      }
      await pollUntil(
        () =>
          isPublishedPortlessRoute(
            this.url(route.hostname),
            this.url(PORTLESS_PROXY_PROBE_HOSTNAME)
          ),
        {
          intervalMs: 50,
          message: `Portless did not activate ${route.hostname}`,
          timeoutMs: 5000,
        }
      );
    });
  }

  prepare(): Promise<void> {
    return serialize(this.stateDirectory, () => this.ensureProxy());
  }

  deactivate(route: LocalRoute): Promise<void> {
    return serialize(this.stateDirectory, async () => {
      const current = this.route(route.hostname);
      if (!current) {
        return;
      }
      if (current.port !== route.port) {
        throw new Error(
          `Refusing to remove ${route.hostname}; it points to backing port ${current.port}`
        );
      }
      this.store.removeRoute(route.hostname);
      // A dead proxy cannot serve a stale alias. Persisted removal is enough;
      // startup reloads the route file before listening again.
      const pid = this.proxyPid();
      if (pid === null || !processIsLive(pid)) {
        return;
      }
      await pollUntil(
        async () =>
          this.route(route.hostname) === null &&
          (await observePortlessRoute(this.url(route.hostname))) ===
            "unregistered",
        {
          intervalMs: 50,
          message: `Portless did not deactivate ${route.hostname}`,
          timeoutMs: 5000,
        }
      );
    });
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
    return pid !== null && processIsLive(pid) && this.isManagedProxy(pid)
      ? "active"
      : "unavailable";
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private async ensureProxy(): Promise<void> {
    // Validate before starting or migrating; malformed state is never replaced.
    this.routes();
    const pid = this.proxyPid();
    if (pid !== null && processIsLive(pid)) {
      if (this.isManagedProxy(pid)) {
        return;
      }
      throw new Error(
        "Routing proxy ownership could not be verified. Stop the existing proxy before starting BranchBase routing."
      );
    }
    await startProxyProcess({
      nodePath: this.nodePath,
      port: this.port,
      stateDirectory: this.stateDirectory,
    });
    await pollUntil(
      () => isPortlessProxyResponding(this.url(PORTLESS_PROXY_PROBE_HOSTNAME)),
      {
        intervalMs: 50,
        message: `Portless proxy did not start on port ${this.port}`,
        timeoutMs: 5000,
      }
    );
  }

  private isManagedProxy(pid: number): boolean {
    const marker = pathModule.join(
      this.stateDirectory,
      "branchbase-runtime.json"
    );
    if (!existsSync(marker)) {
      return false;
    }
    try {
      const value: unknown = JSON.parse(readFileSync(marker, "utf-8"));
      return Boolean(
        value &&
        typeof value === "object" &&
        "pid" in value &&
        value.pid === pid &&
        "processStartMarker" in value &&
        typeof value.processStartMarker === "string" &&
        value.processStartMarker.length > 0 &&
        value.processStartMarker === processStartMarker(pid) &&
        "version" in value &&
        value.version === 1 &&
        "port" in value &&
        value.port === this.port
      );
    } catch {
      throw new Error("BranchBase routing runtime metadata is invalid");
    }
  }

  private proxyPid(): number | null {
    const file = pathModule.join(this.stateDirectory, "proxy.pid");
    if (!existsSync(file)) {
      return null;
    }
    const pid = Number(readFileSync(file, "utf-8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }

  private routes(): PortlessRoute[] {
    const file = pathModule.join(this.stateDirectory, "routes.json");
    if (!existsSync(file)) {
      return [];
    }
    try {
      return PortlessRoutesSchema.parse(
        JSON.parse(readFileSync(file, "utf-8"))
      );
    } catch {
      throw new Error("Portless route state is invalid");
    }
  }

  private route(hostname: string): PortlessRoute | null {
    return this.routes().find((route) => route.hostname === hostname) ?? null;
  }
}
