import { once } from "node:events";
import type { Socket } from "node:net";

import { createProxyServer, RouteStore } from "portless";
import type { ProxyServer } from "portless";

const IPV6_UNAVAILABLE_CODES = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

const port = Number(process.argv[2]);
const stateDirectory = process.argv[3];
if (
  !(Number.isInteger(port) && port >= 1 && port <= 65_535 && stateDirectory)
) {
  throw new Error("Invalid development proxy configuration");
}

const store = new RouteStore(stateDirectory);
const servers: ProxyServer[] = [];
const sockets = new Set<Socket>();
let closePromise: Promise<void> | undefined;

const createServer = (): ProxyServer => {
  const server = createProxyServer({
    getRoutes: () => store.loadRoutes(),
    onError: () => undefined,
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
    await Promise.all(servers.map((server) => closeServer(server)));
  })();
  return closePromise;
};

const exit = async (): Promise<void> => {
  await close();
  process.exit(0);
};

const exitOnFailure = async (): Promise<void> => {
  try {
    await exit();
  } catch {
    process.exit(1);
  }
};

process.once("disconnect", () => {
  void exitOnFailure();
});
process.once("SIGINT", () => {
  void exitOnFailure();
});
process.once("SIGTERM", () => {
  void exitOnFailure();
});
process.on("message", (message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "shutdown"
  ) {
    void exitOnFailure();
  }
});

try {
  const ipv4 = createServer();
  servers.push(ipv4);
  await listen(ipv4, "127.0.0.1");

  const ipv6 = createServer();
  try {
    await listen(ipv6, "::1");
    servers.push(ipv6);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!IPV6_UNAVAILABLE_CODES.has(code ?? "")) {
      throw error;
    }
  }
  process.send?.({ type: "ready" });
} catch (error) {
  await close();
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    process.send?.({ type: "conflict" });
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.send?.({ message, type: "error" });
  }
  process.exit(1);
}
