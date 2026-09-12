import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { PortlessRoutingEngine } from "./portless";

const require = createRequire(import.meta.url);

it("rejects structurally invalid Portless route state", () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-state-")
  );
  try {
    mkdirSync(temporary, { recursive: true });
    writeFileSync(
      pathModule.join(temporary, "routes.json"),
      JSON.stringify([{ hostname: "app.localhost", pid: "wrong", port: 3000 }])
    );
    const routing = new PortlessRoutingEngine({ stateDirectory: temporary });

    expect(() =>
      routing.observe({ hostname: "app.localhost", port: 3000 })
    ).toThrow("Portless route state is invalid");
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("accepts Portless routes with supported tunnel metadata", () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-state-")
  );
  try {
    mkdirSync(temporary, { recursive: true });
    writeFileSync(
      pathModule.join(temporary, "routes.json"),
      JSON.stringify([
        {
          hostname: "app.localhost",
          ngrokPid: 12_345,
          ngrokUrl: "https://example.ngrok.app",
          pid: 0,
          port: 3000,
          tailscaleFunnel: true,
          tailscaleHttpsPort: 443,
          tailscaleUrl: "https://example.ts.net",
        },
      ])
    );
    const routing = new PortlessRoutingEngine({ stateDirectory: temporary });

    expect(routing.observe({ hostname: "app.localhost", port: 3000 })).toBe(
      "unavailable"
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

const packageFile = (packageName: string, ...parts: string[]): string =>
  pathModule.join(
    pathModule.dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );

const listen = async (server: Server, port: number): Promise<number> => {
  const listening = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port");
  }
  return address.port;
};

const close = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return;
  }
  const closed = once(server, "close");
  server.close();
  await closed;
};

const readRouteState = (
  stateDirectory: string
): {
  hostname: string;
  pid: number;
  port: number;
}[] =>
  JSON.parse(
    readFileSync(pathModule.join(stateDirectory, "routes.json"), "utf-8")
  ) as { hostname: string; pid: number; port: number }[];

const readProxyPid = (stateDirectory: string): number =>
  Number(readFileSync(pathModule.join(stateDirectory, "proxy.pid"), "utf-8"));

it("activates a Portless route when the backing app resets connections", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-flap-")
  );
  const stateDirectory = pathModule.join(temporary, "portless");
  const backend = createHttpServer((request) => {
    request.socket.destroy();
  });
  const proxyReservation = createServer();
  const backendListening = once(backend, "listening");
  backend.listen(0, "127.0.0.1");
  await backendListening;
  const backendAddress = backend.address();
  if (!backendAddress || typeof backendAddress === "string") {
    throw new Error("Backend did not expose a TCP port");
  }
  const backendPort = backendAddress.port;
  const proxyPort = await listen(proxyReservation, 0);
  await close(proxyReservation);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory,
  });

  try {
    await routing.prepare();
    await routing.activate({
      hostname: "flaky.branchbase.localhost",
      port: backendPort,
    });
    expect(
      routing.observe({
        hostname: "flaky.branchbase.localhost",
        port: backendPort,
      })
    ).toBe("active");
  } finally {
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(proxyPort),
          PORTLESS_STATE_DIR: stateDirectory,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    await close(backend);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 15_000);

it("reloads consecutive Portless route updates", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-watch-")
  );
  const stateDirectory = pathModule.join(temporary, "portless");
  const backend = createHttpServer((_request, response) => {
    response.end("ok");
  });
  const proxyReservation = createServer();
  const backendListening = once(backend, "listening");
  backend.listen(0, "127.0.0.1");
  await backendListening;
  const backendAddress = backend.address();
  if (!backendAddress || typeof backendAddress === "string") {
    throw new Error("Backend did not expose a TCP port");
  }
  const backendPort = backendAddress.port;
  const proxyPort = await listen(proxyReservation, 0);
  await close(proxyReservation);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory,
  });

  try {
    await routing.prepare();
    await routing.activate({
      hostname: "first.branchbase.localhost",
      port: backendPort,
    });
    expect(
      routing.observe({
        hostname: "first.branchbase.localhost",
        port: backendPort,
      })
    ).toBe("active");

    await routing.activate({
      hostname: "second.branchbase.localhost",
      port: backendPort,
    });
    expect(
      routing.observe({
        hostname: "second.branchbase.localhost",
        port: backendPort,
      })
    ).toBe("active");
  } finally {
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(proxyPort),
          PORTLESS_STATE_DIR: stateDirectory,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    await close(backend);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 15_000);

it("preserves unrelated aliases and proxy ownership during concurrent updates", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-concurrent-")
  );
  const stateDirectory = pathModule.join(temporary, "portless");
  const backend = createHttpServer((_request, response) => {
    response.end("ok");
  });
  const proxyReservation = createServer();
  const backendListening = once(backend, "listening");
  backend.listen(0, "127.0.0.1");
  await backendListening;
  const backendAddress = backend.address();
  if (!backendAddress || typeof backendAddress === "string") {
    throw new Error("Backend did not expose a TCP port");
  }
  const backendPort = backendAddress.port;
  const proxyPort = await listen(proxyReservation, 0);
  await close(proxyReservation);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory,
  });
  const initial = ["one", "two", "three", "four"].map((name) => ({
    hostname: `${name}.branchbase.localhost`,
    port: backendPort,
  }));
  const added = ["five", "six", "seven", "eight"].map((name) => ({
    hostname: `${name}.branchbase.localhost`,
    port: backendPort,
  }));

  try {
    await routing.prepare();
    await Promise.all(initial.map((route) => routing.activate(route)));
    const proxyPid = readProxyPid(stateDirectory);

    await Promise.all([
      ...initial.slice(0, 2).map((route) => routing.deactivate(route)),
      ...added.map((route) => routing.activate(route)),
    ]);

    const routes = readRouteState(stateDirectory);
    expect(readProxyPid(stateDirectory)).toBe(proxyPid);
    expect(routes.map((route) => route.hostname).toSorted()).toEqual(
      [...initial.slice(2), ...added].map((route) => route.hostname).toSorted()
    );
    for (const route of [...initial.slice(2), ...added]) {
      expect(routing.observe(route)).toBe("active");
    }
  } finally {
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(proxyPort),
          PORTLESS_STATE_DIR: stateDirectory,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    await close(backend);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 20_000);

it("fails closed when route state becomes corrupt during rapid updates", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-corrupt-")
  );
  const stateDirectory = pathModule.join(temporary, "portless");
  const backend = createHttpServer((_request, response) => {
    response.end("ok");
  });
  const proxyReservation = createServer();
  const backendListening = once(backend, "listening");
  backend.listen(0, "127.0.0.1");
  await backendListening;
  const backendAddress = backend.address();
  if (!backendAddress || typeof backendAddress === "string") {
    throw new Error("Backend did not expose a TCP port");
  }
  const backendPort = backendAddress.port;
  const proxyPort = await listen(proxyReservation, 0);
  await close(proxyReservation);
  const routing = new PortlessRoutingEngine({
    port: proxyPort,
    stateDirectory,
  });
  const route = { hostname: "corrupt.branchbase.localhost", port: backendPort };

  try {
    await routing.prepare();
    await routing.activate(route);
    writeFileSync(pathModule.join(stateDirectory, "routes.json"), "{\n");

    expect(() => routing.observe(route)).toThrow(
      "Portless route state is invalid"
    );
    await expect(routing.activate(route)).rejects.toThrow(
      "Portless route state is invalid"
    );
  } finally {
    spawnSync(
      packageFile("node", "bin", "node"),
      [packageFile("portless", "dist", "cli.js"), "proxy", "stop"],
      {
        env: {
          ...process.env,
          PORTLESS_HTTPS: "0",
          PORTLESS_PORT: String(proxyPort),
          PORTLESS_STATE_DIR: stateDirectory,
          PORTLESS_SYNC_HOSTS: "0",
        },
      }
    );
    await close(backend);
    rmSync(temporary, { force: true, recursive: true });
  }
}, 15_000);
