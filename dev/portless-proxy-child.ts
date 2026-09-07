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

const listen = (server: ProxyServer, host: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const handlers = {
      onError(error: Error) {
        server.off("listening", handlers.onListening);
        reject(error);
      },
      onListening() {
        server.off("error", handlers.onError);
        resolve();
      },
    };
    server.once("error", handlers.onError);
    server.once("listening", handlers.onListening);
    server.listen({ host, ipv6Only: true, port });
  });

const closeServer = (server: ProxyServer): Promise<void> => {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => server.close(() => resolve()));
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

process.once("disconnect", () => {
  exit().catch(() => process.exit(1));
});
process.once("SIGINT", () => {
  exit().catch(() => process.exit(1));
});
process.once("SIGTERM", () => {
  exit().catch(() => process.exit(1));
});
process.on("message", (message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "shutdown"
  ) {
    exit().catch(() => process.exit(1));
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
