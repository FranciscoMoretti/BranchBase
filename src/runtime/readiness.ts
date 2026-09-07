import { createConnection, createServer } from "node:net";

import type { BranchBaseApp } from "../config/branchbase-schema";
import { inspectHttpStatus } from "../host/http-inspection";
import type { RunEndpoint } from "./local-state";

const POLL_INTERVAL_MS = 50;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface BackingPortLease {
  port: number;
  release: () => Promise<void>;
}

export async function reserveBackingPort(
  excluded: ReadonlySet<number> = new Set()
): Promise<BackingPortLease> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reserved = await new Promise<BackingPortLease>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Could not allocate a port")));
          return;
        }
        let released = false;
        resolve({
          port: address.port,
          release: () =>
            new Promise<void>((releaseResolve, releaseReject) => {
              if (released) {
                releaseResolve();
                return;
              }
              released = true;
              server.close((error) =>
                error ? releaseReject(error) : releaseResolve()
              );
            }),
        });
      });
    });
    if (!excluded.has(reserved.port)) {
      return reserved;
    }
    await reserved.release();
  }
  throw new Error("Could not allocate an unused Backing endpoint");
}

function tcpReady(endpoint: RunEndpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: endpoint.host,
      port: endpoint.port,
    });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function acceptedStatusRange(app: BranchBaseApp): [number, number] {
  if (app.readiness === "tcp") {
    return [200, 399];
  }
  const [minimum, maximum] = app.readiness.statuses.split("-").map(Number) as [
    number,
    number,
  ];
  return [minimum, maximum];
}

async function httpReady(
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<boolean> {
  if (!(endpoint.directUrl && app.readiness !== "tcp")) {
    return false;
  }
  const [minimum, maximum] = acceptedStatusRange(app);
  try {
    const response = await fetch(
      new URL(app.readiness.path, endpoint.directUrl),
      { signal: AbortSignal.timeout(500) }
    );
    return response.status >= minimum && response.status <= maximum;
  } catch {
    return false;
  }
}

export function appIsReady(
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<boolean> {
  return app.readiness === "tcp"
    ? tcpReady(endpoint)
    : httpReady(app, endpoint);
}

export function appIsReadySync(
  app: BranchBaseApp,
  endpoint: RunEndpoint,
  listening: boolean
): boolean {
  if (!listening) {
    return false;
  }
  if (app.readiness === "tcp") {
    return true;
  }
  if (!endpoint.directUrl) {
    return false;
  }
  const [minimum, maximum] = acceptedStatusRange(app);
  const status = inspectHttpStatus(
    new URL(app.readiness.path, endpoint.directUrl).toString()
  );
  return status !== null && status >= minimum && status <= maximum;
}

export async function waitForAppReadiness(
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<void> {
  const timeoutSeconds =
    app.readiness === "tcp" ? 60 : app.readiness.timeoutSeconds;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await appIsReady(app, endpoint)) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `${app.name ?? endpoint.appId} did not become ready within ${timeoutSeconds} seconds`
  );
}
