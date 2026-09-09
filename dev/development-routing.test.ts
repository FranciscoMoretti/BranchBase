import { expect, it } from "bun:test";
import { ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request } from "node:http";
import type { IncomingMessage } from "node:http";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import pathModule from "node:path";
import { fileURLToPath } from "node:url";

import { delay, pollUntil } from "../src/runtime/async-utils";
import { reserveBackingPort } from "../src/runtime/readiness";
import {
  DevelopmentProxyPortConflictError,
  DevelopmentRouting,
  waitForExit as waitForRoutingExit,
} from "./development-routing";

const listenBackend = (
  port = 0
): Promise<{
  close: () => Promise<void>;
  port: number;
}> => {
  const server = createHttpServer((_request, response) => {
    response.end("backend");
  });
  return (async () => {
    const listening = once(server, "listening");
    server.listen(port, "127.0.0.1");
    await listening;
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Backend did not expose a TCP port");
    }
    return {
      close: async () => {
        const closed = once(server, "close");
        server.close();
        await closed;
      },
      port: address.port,
    };
  })();
};

const proxyResponse = async (
  port: number,
  hostname: string,
  proxyHost = "127.0.0.1",
  timeoutMs = 1000
): Promise<{ body: string; status: number }> => {
  const proxyRequest = request({
    headers: { host: `${hostname}:${port}` },
    host: proxyHost,
    port,
  });
  proxyRequest.setTimeout(timeoutMs, () =>
    proxyRequest.destroy(
      new Error(`Proxy request timed out after ${timeoutMs} ms`)
    )
  );
  proxyRequest.end();
  const [response] = (await once(proxyRequest, "response")) as [
    IncomingMessage,
  ];
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.from(chunk));
  }
  return {
    body: Buffer.concat(chunks).toString("utf-8"),
    status: response.statusCode ?? 0,
  };
};

it("waits for a child close after a shutdown error", async () => {
  const child = new ChildProcess();
  const closing = waitForRoutingExit(child);
  let outcome = "pending";
  const observed = (async () => {
    try {
      await closing;
      outcome = "closed";
    } catch {
      outcome = "rejected";
    }
  })();

  child.emit("error", new Error("shutdown failed"));
  await Promise.resolve();
  expect(outcome).toBe("pending");
  child.emit("close");

  await observed;
  expect(outcome).toBe("closed");
});

const listenOnPort = async (
  port: number,
  host: string
): Promise<() => Promise<void>> => {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(port, host);
  await listening;
  return async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
  };
};

const waitForChildReady = async (child: ChildProcess): Promise<void> => {
  const result: PromiseWithResolvers<void> = Promise.withResolvers();
  const handlers = {
    cleanup() {
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
        new Error("Development routing harness exited before startup")
      );
    },
    onMessage(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "ready"
      ) {
        handlers.cleanup();
        result.resolve();
      }
    },
  };
  child.once("error", handlers.onError);
  child.once("exit", handlers.onExit);
  child.on("message", handlers.onMessage);
  return await result.promise;
};

const waitForExit = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await once(child, "exit");
};

const waitForProxyStatus = async (
  port: number,
  hostname: string,
  expected: number
): Promise<void> => {
  await pollUntil(
    async () => {
      try {
        const response = await proxyResponse(port, hostname);
        return response.status === expected;
      } catch {
        // Timed-out or refused requests keep polling until the deadline.
        return false;
      }
    },
    {
      intervalMs: 25,
      message: `Proxy did not return status ${expected}`,
      timeoutMs: 5000,
    }
  );
};

const reopenAfterParentExit = async (
  port: number,
  stateDirectory: string
): Promise<DevelopmentRouting> => {
  const deadline = Date.now() + 5000;
  do {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Proxy reopen retries are serialized to preserve conflict handling.
      return await DevelopmentRouting.open({ port, stateDirectory });
    } catch (error) {
      if (!(error instanceof DevelopmentProxyPortConflictError)) {
        throw error;
      }
      // oxlint-disable-next-line no-await-in-loop -- Proxy reopen retries are serialized to preserve conflict handling.
      await delay(25);
    }
  } while (Date.now() < deadline);
  throw new Error(
    `Development proxy on port ${port} remained after parent exit`
  );
};

it("routes through the embedded development proxy", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-")
  );
  const reservation = await reserveBackingPort();
  const { port } = reservation;
  const backend = await listenBackend();
  let routing: DevelopmentRouting | undefined;

  try {
    await reservation.release();
    routing = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    expect(
      routing.observe({ hostname: "app.localhost", port: backend.port })
    ).toBe("inactive");

    await routing.activate({
      hostname: "app.localhost",
      port: backend.port,
    });
    expect(
      routing.observe({ hostname: "app.localhost", port: backend.port })
    ).toBe("active");
    expect(await proxyResponse(port, "app.localhost")).toEqual({
      body: "backend",
      status: 200,
    });
    expect(await proxyResponse(port, "app.localhost", "::1")).toEqual({
      body: "backend",
      status: 200,
    });

    await routing.deactivate({
      hostname: "app.localhost",
      port: backend.port,
    });
    expect(
      routing.observe({ hostname: "app.localhost", port: backend.port })
    ).toBe("inactive");
    const unregistered = await proxyResponse(port, "app.localhost");
    expect(unregistered.status).toBe(404);
    expect(unregistered.body).toContain(
      "No app registered for <strong>app.localhost</strong>"
    );
  } finally {
    await routing?.close();
    await backend.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("publishes a route before the backing app accepts traffic", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-observe-")
  );
  const proxyReservation = await reserveBackingPort();
  const backendReservation = await reserveBackingPort(
    new Set([proxyReservation.port])
  );
  const route = {
    hostname: "delayed.localhost",
    port: backendReservation.port,
  };
  let backend: Awaited<ReturnType<typeof listenBackend>> | undefined;
  let routing: DevelopmentRouting | undefined;

  try {
    await proxyReservation.release();
    await backendReservation.release();
    routing = await DevelopmentRouting.open({
      port: proxyReservation.port,
      stateDirectory: temporary,
    });
    await routing.activate(route);
    expect(routing.observe(route)).toBe("active");
    const unavailable = await proxyResponse(
      proxyReservation.port,
      route.hostname
    );
    expect(unavailable.status).toBe(502);

    backend = await listenBackend(route.port);
    await waitForProxyStatus(proxyReservation.port, route.hostname, 200);
    expect(routing.observe(route)).toBe("active");
  } finally {
    await routing?.close();
    await backend?.close();
    await backendReservation.release();
    await proxyReservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("restores persistent aliases when the embedded proxy reopens", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-reopen-")
  );
  const reservation = await reserveBackingPort();
  const { port } = reservation;
  const backend = await listenBackend();
  let first: DevelopmentRouting | undefined;
  let reopened: DevelopmentRouting | undefined;

  try {
    await reservation.release();
    first = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    await first.activate({
      hostname: "app.localhost",
      port: backend.port,
    });
    await first.close();
    first = undefined;

    reopened = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    expect(
      reopened.observe({ hostname: "app.localhost", port: backend.port })
    ).toBe("active");
    const reopenedResponse = await proxyResponse(port, "app.localhost");
    expect(reopenedResponse.status).toBe(200);
  } finally {
    await reopened?.close();
    await first?.close();
    await backend.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("keeps a published route active while its backend recovers", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-recovery-")
  );
  const reservation = await reserveBackingPort();
  const { port } = reservation;
  const route = { hostname: "recovering.localhost", port: 0 };
  let backend: Awaited<ReturnType<typeof listenBackend>> | undefined;
  let first: DevelopmentRouting | undefined;
  let reopened: DevelopmentRouting | undefined;

  try {
    await reservation.release();
    backend = await listenBackend();
    route.port = backend.port;
    first = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    await first.activate(route);
    await first.close();
    first = undefined;
    await backend.close();
    backend = undefined;

    reopened = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    expect(reopened.observe(route)).toBe("active");
    const unavailable = await proxyResponse(port, route.hostname);
    expect(unavailable.status).toBe(502);

    backend = await listenBackend(route.port);
    await waitForProxyStatus(port, route.hostname, 200);
    expect(reopened.observe(route)).toBe("active");

    await backend.close();
    backend = undefined;
    expect(reopened.observe(route)).toBe("active");
    const unavailableAgain = await proxyResponse(port, route.hostname);
    expect(unavailableAgain.status).toBe(502);

    backend = await listenBackend(route.port);
    await waitForProxyStatus(port, route.hostname, 200);
    expect(reopened.observe(route)).toBe("active");
  } finally {
    await reopened?.close();
    await first?.close();
    await backend?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);

it("rejects occupied ports and releases both loopback listeners", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-port-")
  );
  const reservation = await reserveBackingPort();
  const { port } = reservation;
  let routing: DevelopmentRouting | undefined;
  let closeIpv4: (() => Promise<void>) | undefined;
  let closeIpv6: (() => Promise<void>) | undefined;

  try {
    await expect(
      DevelopmentRouting.open({ port, stateDirectory: temporary })
    ).rejects.toBeInstanceOf(DevelopmentProxyPortConflictError);
    await reservation.release();

    closeIpv6 = await listenOnPort(port, "::1");
    await expect(
      DevelopmentRouting.open({ port, stateDirectory: temporary })
    ).rejects.toBeInstanceOf(DevelopmentProxyPortConflictError);
    closeIpv4 = await listenOnPort(port, "127.0.0.1");
    await closeIpv4();
    closeIpv4 = undefined;
    await closeIpv6();
    closeIpv6 = undefined;

    routing = await DevelopmentRouting.open({
      port,
      stateDirectory: temporary,
    });
    const socket = createConnection({ host: "127.0.0.1", port });
    const connected = once(socket, "connect");
    await connected;
    const socketClosed = once(socket, "close");
    await routing.close();
    await socketClosed;
    await routing.close();
    routing = undefined;

    closeIpv4 = await listenOnPort(port, "127.0.0.1");
    closeIpv6 = await listenOnPort(port, "::1");
  } finally {
    await closeIpv6?.();
    await closeIpv4?.();
    await routing?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("stops the proxy when its Bun parent is killed", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-routing-crash-")
  );
  const reservation = await reserveBackingPort();
  const { port } = reservation;
  await reservation.release();
  const parent = fork(
    fileURLToPath(
      new URL("development-routing-crash-harness.ts", import.meta.url)
    ),
    [String(port), temporary],
    {
      execPath: process.execPath,
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }
  );
  let reopened: DevelopmentRouting | undefined;

  try {
    await waitForChildReady(parent);
    parent.kill("SIGKILL");
    await waitForExit(parent);
    reopened = await reopenAfterParentExit(port, temporary);
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) {
      parent.kill("SIGKILL");
      await waitForExit(parent);
    }
    await reopened?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
}, 10_000);
