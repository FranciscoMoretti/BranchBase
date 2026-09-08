import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import pathModule from "node:path";
import { fileURLToPath } from "node:url";

import { RouteStore } from "portless";

import { delay } from "../src/runtime/async-utils";
import type {
  LocalRoute,
  LocalRouteState,
  LocalRoutingEngine,
} from "../src/runtime/local-routing";
import {
  isPublishedPortlessRoute,
  observePortlessRoute,
  PORTLESS_PROXY_PROBE_HOSTNAME,
} from "../src/runtime/portless-observation";
import { DevelopmentProxyPortConflictError } from "./development-proxy-port-conflict-error";

export { DevelopmentProxyPortConflictError } from "./development-proxy-port-conflict-error";

const require = createRequire(import.meta.url);
const OBSERVATION_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 2500;

type ProxyMessage =
  | { type: "conflict" }
  | { message: string; type: "error" }
  | { type: "ready" };

const proxyMessage = (message: unknown): ProxyMessage | null => {
  if (!(typeof message === "object" && message !== null && "type" in message)) {
    return null;
  }
  const candidate = message as { message?: unknown; type?: unknown };
  if (candidate.type === "ready" || candidate.type === "conflict") {
    return { type: candidate.type };
  }
  if (candidate.type === "error" && typeof candidate.message === "string") {
    return { message: candidate.message, type: "error" };
  }
  return null;
};

const packageFile = (packageName: string, ...parts: string[]): string =>
  pathModule.join(
    pathModule.dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );

const routeInStore = (store: RouteStore, hostname: string) =>
  store.loadRoutes().find((route) => route.hostname === hostname) ?? null;

const routeKey = (hostname: string, port: number): string =>
  `${hostname}\0${port}`;

const ignoreChildError = () => null;

const waitUntil = async (
  condition: () => Promise<boolean>,
  message: string
): Promise<void> => {
  const deadline = Date.now() + OBSERVATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Proxy readiness polling observes each attempt before waiting.
    if (await condition()) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Proxy readiness polling observes each attempt before waiting.
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(message);
};

export const waitForExit = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  // oxlint-disable-next-line typescript/no-invalid-void-type -- A completion-only deferred should resolve without a sentinel value.
  const result = Promise.withResolvers<void>();
  const onClose = () => {
    child.off("error", ignoreChildError);
    result.resolve();
  };
  child.on("error", ignoreChildError);
  child.once("close", onClose);
  await result.promise;
};

export class DevelopmentRouting implements LocalRoutingEngine {
  private closePromise: Promise<void> | undefined;
  private readonly child: ChildProcess;
  private readonly routeVerifications = new Map<string, Promise<void>>();
  private readonly store: RouteStore;
  private readonly verifiedRoutes = new Set<string>();
  readonly port: number;
  readonly stateDirectory: string;

  private constructor(options: {
    child: ChildProcess;
    port: number;
    stateDirectory: string;
  }) {
    this.child = options.child;
    this.port = options.port;
    this.stateDirectory = options.stateDirectory;
    this.store = new RouteStore(options.stateDirectory);
  }

  static async open(options: {
    port: number;
    stateDirectory: string;
  }): Promise<DevelopmentRouting> {
    const child = fork(
      fileURLToPath(new URL("portless-proxy-child.ts", import.meta.url)),
      [String(options.port), options.stateDirectory],
      {
        execPath: packageFile("node", "bin", "node"),
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      }
    );
    try {
      await DevelopmentRouting.waitUntilReady(child, options.port);
      const routing = new DevelopmentRouting({ ...options, child });
      await routing.refreshVerifiedRoutes();
      return routing;
    } catch (error) {
      child.kill("SIGKILL");
      await waitForExit(child);
      throw error;
    }
  }

  async activate(route: LocalRoute): Promise<void> {
    await this.prepare();
    const current = routeInStore(this.store, route.hostname);
    if (current && current.port !== route.port) {
      throw new Error(
        `${route.hostname} is already routed to backing port ${current.port}`
      );
    }
    if (!current) {
      this.store.addRoute(route.hostname, route.port, 0);
    }
    await waitUntil(
      async () =>
        this.isLive() &&
        (await isPublishedPortlessRoute(
          this.url(route.hostname),
          this.url(PORTLESS_PROXY_PROBE_HOSTNAME)
        )),
      `Portless did not activate ${route.hostname}`
    );
    this.verifiedRoutes.add(routeKey(route.hostname, route.port));
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeChild();
    return this.closePromise;
  }

  deactivate(route: LocalRoute): Promise<void> {
    const current = routeInStore(this.store, route.hostname);
    if (!current) {
      return Promise.resolve();
    }
    if (current.port !== route.port) {
      return Promise.reject(
        new Error(
          `Refusing to remove ${route.hostname}; it points to backing port ${current.port}`
        )
      );
    }
    this.verifiedRoutes.delete(routeKey(route.hostname, route.port));
    this.store.removeRoute(route.hostname, 0);
    return waitUntil(
      async () =>
        (await observePortlessRoute(this.url(route.hostname))) ===
        "unregistered",
      `Portless did not deactivate ${route.hostname}`
    );
  }

  observe(route: LocalRoute): LocalRouteState {
    const current = routeInStore(this.store, route.hostname);
    if (!current) {
      return "inactive";
    }
    if (current.port !== route.port) {
      return "conflict";
    }
    if (!this.isLive()) {
      return "unavailable";
    }
    const key = routeKey(route.hostname, route.port);
    this.verifyRoute(route.hostname, route.port);
    return this.verifiedRoutes.has(key) ? "active" : "unavailable";
  }

  prepare(): Promise<void> {
    return this.isLive()
      ? Promise.resolve()
      : Promise.reject(
          new Error(`Portless proxy on port ${this.port} is not available`)
        );
  }

  url(hostname: string): string {
    return `http://${hostname}${this.port === 80 ? "" : `:${this.port}`}`;
  }

  private static async waitUntilReady(
    child: ChildProcess,
    port: number
  ): Promise<void> {
    // oxlint-disable-next-line typescript/no-invalid-void-type -- A completion-only deferred should resolve without a sentinel value.
    const result = Promise.withResolvers<void>();
    const timeoutState: {
      handle: ReturnType<typeof setTimeout> | null;
    } = { handle: null };
    const handlers = {
      cleanup() {
        if (timeoutState.handle) {
          clearTimeout(timeoutState.handle);
        }
        child.off("error", handlers.onError);
        child.off("exit", handlers.onExit);
        child.off("message", handlers.onMessage);
      },
      onError(error: Error) {
        handlers.cleanup();
        result.reject(error);
      },
      onExit() {
        handlers.cleanup();
        result.reject(
          new Error(`Portless proxy did not start on port ${port}`)
        );
      },
      onMessage(message: unknown) {
        const received = proxyMessage(message);
        if (received?.type === "ready") {
          handlers.cleanup();
          result.resolve();
        } else if (received?.type === "conflict") {
          handlers.cleanup();
          result.reject(new DevelopmentProxyPortConflictError(port));
        } else if (received?.type === "error") {
          handlers.cleanup();
          result.reject(new Error(received.message));
        }
      },
    };
    timeoutState.handle = setTimeout(() => {
      handlers.cleanup();
      result.reject(new Error(`Portless proxy did not start on port ${port}`));
    }, START_TIMEOUT_MS);
    child.once("error", handlers.onError);
    child.once("exit", handlers.onExit);
    child.on("message", handlers.onMessage);
    return await result.promise;
  }

  private async closeChild(): Promise<void> {
    if (!this.isLive()) {
      await waitForExit(this.child);
      return;
    }
    try {
      if (this.child.connected) {
        // ChildProcess.send exposes its asynchronous error through this callback.
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- required by the ChildProcess bridge
        this.child.send({ type: "shutdown" }, (error) => {
          if (error && this.isLive()) {
            this.child.kill("SIGTERM");
          }
        });
      } else {
        this.child.kill("SIGTERM");
      }
    } catch {
      this.child.kill("SIGTERM");
    }
    const timeoutResult = Promise.withResolvers<false>();
    const timeout = setTimeout(
      () => timeoutResult.resolve(false),
      STOP_TIMEOUT_MS
    );
    let timedOut = false;
    try {
      timedOut =
        (await Promise.race([
          waitForExit(this.child),
          timeoutResult.promise,
        ])) === false;
    } finally {
      clearTimeout(timeout);
    }
    if (timedOut && this.isLive()) {
      this.child.kill("SIGKILL");
      await waitForExit(this.child);
    }
  }

  private async refreshVerifiedRoutes(): Promise<void> {
    const routes = this.store.loadRoutes();
    await Promise.all(
      routes.map(async (route) => {
        if (
          this.isLive() &&
          (await isPublishedPortlessRoute(
            this.url(route.hostname),
            this.url(PORTLESS_PROXY_PROBE_HOSTNAME)
          ))
        ) {
          this.verifiedRoutes.add(routeKey(route.hostname, route.port));
        }
      })
    );
  }

  private verifyRoute(hostname: string, port: number): void {
    const key = routeKey(hostname, port);
    if (this.routeVerifications.has(key)) {
      return;
    }
    const verification = (async () => {
      try {
        const published = await isPublishedPortlessRoute(
          this.url(hostname),
          this.url(PORTLESS_PROXY_PROBE_HOSTNAME)
        );
        const current = routeInStore(this.store, hostname);
        if (published && current?.port === port && this.isLive()) {
          this.verifiedRoutes.add(key);
        } else {
          this.verifiedRoutes.delete(key);
        }
      } catch {
        // Background verification is best-effort; a later observation retries.
      } finally {
        this.routeVerifications.delete(key);
      }
    })();
    this.routeVerifications.set(key, verification);
  }

  private isLive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }
}
