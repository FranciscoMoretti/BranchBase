import { createConnection, createServer } from "node:net";
import { promisify } from "node:util";

import { inspectHttpStatus } from "../adapters/host/http-inspection";
import { pollUntil } from "../adapters/host/polling";
import type { BranchBaseApp } from "../configuration/branchbase-schema";
import type { RunEndpoint } from "./assignments";

const POLL_INTERVAL_MS = 50;

export interface BackingPortLease {
  port: number;
  release: () => Promise<void>;
}

export const reserveBackingPort = async (
  excluded: ReadonlySet<number> = new Set()
): Promise<BackingPortLease> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = Promise.withResolvers<BackingPortLease>();
    const server = createServer();
    server.once("error", result.reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        result.reject(new Error("Could not allocate a port"));
        return;
      }
      let released = false;
      result.resolve({
        port: address.port,
        release: async () => {
          if (released) {
            return;
          }
          released = true;
          await promisify(server.close.bind(server))();
        },
      });
    });
    // oxlint-disable-next-line no-await-in-loop -- Backing port reservations retry sequentially against shared exclusions.
    const reserved = await result.promise;
    if (!excluded.has(reserved.port)) {
      return reserved;
    }
    // oxlint-disable-next-line no-await-in-loop -- Backing port reservations release an excluded port before retrying.
    await reserved.release();
  }
  throw new Error("Could not allocate an unused Backing endpoint");
};

const tcpReady = async (endpoint: RunEndpoint): Promise<boolean> => {
  const result = Promise.withResolvers<boolean>();
  const socket = createConnection({
    host: endpoint.host,
    port: endpoint.port,
  });
  const finish = (ready: boolean) => {
    socket.destroy();
    result.resolve(ready);
  };
  socket.setTimeout(300, () => finish(false));
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  return await result.promise;
};

const acceptedStatusRange = (app: BranchBaseApp): [number, number] => {
  if (app.readiness === "tcp") {
    return [200, 399];
  }
  const [minimum, maximum] = app.readiness.statuses.split("-").map(Number) as [
    number,
    number,
  ];
  return [minimum, maximum];
};

const httpReady = async (
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<boolean> => {
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
};

export const appIsReady = (
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<boolean> =>
  app.readiness === "tcp" ? tcpReady(endpoint) : httpReady(app, endpoint);

export const appIsReadySync = (
  app: BranchBaseApp,
  endpoint: RunEndpoint,
  listening: boolean
): boolean => {
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
};

export const waitForAppReadiness = async (
  app: BranchBaseApp,
  endpoint: RunEndpoint
): Promise<void> => {
  const timeoutSeconds =
    app.readiness === "tcp" ? 60 : app.readiness.timeoutSeconds;
  await pollUntil(() => appIsReady(app, endpoint), {
    intervalMs: POLL_INTERVAL_MS,
    message: `${app.name ?? endpoint.appId} did not become ready within ${timeoutSeconds} seconds`,
    timeoutMs: timeoutSeconds * 1000,
  });
};
