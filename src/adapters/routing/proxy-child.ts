import { once } from "node:events";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import pathModule from "node:path";

import { createProxyServer, RouteStore } from "portless";
import type { ProxyServer } from "portless";

import { processStartMarker } from "../host/process-inspection.ts";

const IPV6_UNAVAILABLE_CODES = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

const [portText, stateDirectory] = process.argv.slice(2);
const port = Number(portText);
if (
  !(Number.isInteger(port) && port >= 1 && port <= 65_535 && stateDirectory)
) {
  throw new Error("Invalid proxy configuration");
}

const store = new RouteStore(stateDirectory);
const servers: ProxyServer[] = [];
const sockets = new Set<Socket>();
let closePromise: Promise<void> | undefined;
const marker = pathModule.join(stateDirectory, "branchbase-runtime.json");
const pidFile = pathModule.join(stateDirectory, "proxy.pid");
const portFile = pathModule.join(stateDirectory, "proxy.port");

const createServer = (): ProxyServer => {
  const server = createProxyServer({
    getRoutes: () => store.loadRoutes(),
    onError: () => {
      // Proxy errors are represented by lifecycle observations.
    },
    proxyPort: port,
    strict: true,
    tld: "localhost",
    tlds: ["localhost"],
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return server;
};

const listen = async (server: ProxyServer, host: string): Promise<void> => {
  const listening = once(server, "listening");
  server.listen({ host, ipv6Only: true, port });
  await listening;
};

const closeServer = async (server: ProxyServer): Promise<void> => {
  if (!server.listening) {
    return;
  }
  const closed = once(server, "close");
  server.close();
  await closed;
};

const close = (): Promise<void> => {
  closePromise ??= (async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await Promise.all(servers.map(closeServer));
    try {
      if (Number(readFileSync(pidFile, "utf-8")) === process.pid) {
        for (const file of [pidFile, portFile, marker]) {
          if (existsSync(file)) {
            unlinkSync(file);
          }
        }
      }
    } catch {
      // Cleanup is best effort during process shutdown.
    }
  })();
  return closePromise;
};

const exit = async (): Promise<void> => {
  await close();
  process.exit(0);
};
const handleExit = async (): Promise<void> => {
  try {
    await exit();
  } catch {
    process.exit(1);
  }
};
process.once("SIGINT", handleExit);
process.once("SIGTERM", handleExit);

try {
  const ipv4 = createServer();
  servers.push(ipv4);
  await listen(ipv4, "127.0.0.1");
  const ipv6 = createServer();
  try {
    await listen(ipv6, "::1");
    servers.push(ipv6);
  } catch (error) {
    if (
      !IPV6_UNAVAILABLE_CODES.has((error as NodeJS.ErrnoException).code ?? "")
    ) {
      throw error;
    }
  }
  writeFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
  writeFileSync(portFile, `${port}\n`, { mode: 0o600 });
  writeFileSync(
    marker,
    `${JSON.stringify({
      pid: process.pid,
      port,
      processStartMarker: processStartMarker(process.pid),
      version: 1,
    })}\n`,
    { mode: 0o600 }
  );
  process.send?.({ type: "ready" });
} catch (error) {
  await close();
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    process.send?.({ type: "conflict" });
  } else {
    process.send?.({
      message: error instanceof Error ? error.message : String(error),
      type: "error",
    });
  }
  process.exit(1);
}
