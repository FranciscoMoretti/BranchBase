import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { PortlessRoutingEngine } from "./local-routing";

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

function packageFile(packageName: string, ...parts: string[]): string {
  return pathModule.join(
    pathModule.dirname(require.resolve(`${packageName}/package.json`)),
    ...parts
  );
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

it("activates a Portless route when the backing app resets connections", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-portless-flap-")
  );
  const stateDirectory = pathModule.join(temporary, "portless");
  const backend = createHttpServer((request) => {
    request.socket.destroy();
  });
  const proxyReservation = createServer();
  const backendPort = await new Promise<number>((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address();
      if (!address || typeof address === "string") {
        reject(new Error("Backend did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
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
    await new Promise<void>((resolve) => backend.close(() => resolve()));
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
  const backendPort = await new Promise<number>((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address();
      if (!address || typeof address === "string") {
        reject(new Error("Backend did not expose a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
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
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    rmSync(temporary, { force: true, recursive: true });
  }
}, 15_000);
