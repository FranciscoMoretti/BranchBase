import { expect, it, spyOn } from "bun:test";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { reserveBackingPort } from "../src/app-group/readiness";
import type { DevelopmentRouting } from "./development-routing";
import { openDevelopmentSession } from "./development-session";
import { acquireExclusiveFileLock } from "./exclusive-file-lock";

const listenOnPort = async (port: number): Promise<() => Promise<void>> => {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await listening;
  return async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
  };
};

it("isolates development resources from the production runtime", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-")
  );
  const homeDirectory = pathModule.join(temporary, "home");
  const appRoot = realpathSync(".");
  const proxyPort = await reserveBackingPort();
  const expectedProductionDirectory = pathModule.join(
    homeDirectory,
    ".branchbase"
  );
  const productionState = pathModule.join(
    expectedProductionDirectory,
    "state.json"
  );
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    mkdirSync(expectedProductionDirectory, { recursive: true });
    writeFileSync(productionState, "production-state\n");
    const { port } = proxyPort;
    await proxyPort.release();
    opened = await openDevelopmentSession({
      appRoot,
      environment: {
        BRANCHBASE_CODEX_CONTROL_DIR: pathModule.join(
          expectedProductionDirectory,
          "codex"
        ),
        BRANCHBASE_PORTLESS_PORT: String(port),
      },
      homeDirectory,
    });

    expect(opened.profile.controlDirectory).toStartWith(
      pathModule.join(expectedProductionDirectory, "development")
    );
    expect(opened.profile.controlDirectory).not.toBe(
      expectedProductionDirectory
    );
    expect(opened.profile.statePath).toBe(
      pathModule.join(opened.profile.controlDirectory, "state.json")
    );
    expect(opened.profile.portlessStateDirectory).toBe(
      pathModule.join(opened.profile.controlDirectory, "portless")
    );
    expect(opened.profile.codexControlDirectory).toBe(
      pathModule.join(opened.profile.controlDirectory, "codex")
    );
    expect(opened.profile.dashboardPort).toBe(0);
    expect(opened.profile.portlessPort).toBe(port);
    expect(readFileSync(productionState, "utf-8")).toBe("production-state\n");
  } finally {
    await opened?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("allows only one development writer per checkout", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-lock-")
  );
  const proxyPort = await reserveBackingPort();
  const { port } = proxyPort;
  let first: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let reopened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  const options = {
    appRoot: realpathSync("."),
    environment: { BRANCHBASE_PORTLESS_PORT: String(port) },
    homeDirectory: pathModule.join(temporary, "home"),
  };

  try {
    await proxyPort.release();
    first = await openDevelopmentSession(options);
    await expect(openDevelopmentSession(options)).rejects.toThrow(
      "BranchBase development is already running for this checkout"
    );
    await first.close();
    first = undefined;
    reopened = await openDevelopmentSession(options);
    expect(reopened.profile.portlessPort).toBe(port);
  } finally {
    await reopened?.close();
    await first?.close();
    await proxyPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects an empty explicit development proxy port", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-empty-port-")
  );

  try {
    await expect(
      openDevelopmentSession({
        appRoot: realpathSync("."),
        environment: { BRANCHBASE_PORTLESS_PORT: "" },
        homeDirectory: pathModule.join(temporary, "home"),
      })
    ).rejects.toThrow(
      "BRANCHBASE_PORTLESS_PORT must be an integer between 1 and 65535"
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("releases session ownership when proxy shutdown fails", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-close-")
  );
  const options = {
    appRoot: realpathSync("."),
    environment: {},
    homeDirectory: pathModule.join(temporary, "home"),
  };
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let closeProxy: (() => Promise<void>) | undefined;

  try {
    opened = await openDevelopmentSession(options);
    const routing = opened.controllerRuntime.routing as DevelopmentRouting;
    closeProxy = routing.close.bind(routing);
    routing.close = () =>
      Promise.reject(new Error("simulated shutdown failure"));
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(opened.close()).resolves.toBeUndefined();
    } finally {
      warning.mockRestore();
    }
    const releaseLease = acquireExclusiveFileLock(
      pathModule.join(
        opened.profile.controlDirectory,
        "server.lock.guard.sqlite"
      )
    );
    releaseLease();
    await closeProxy();
    closeProxy = undefined;
    opened = undefined;
  } finally {
    try {
      await closeProxy?.();
    } catch {
      // Best-effort cleanup for an assertion failure.
    }
    await opened?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("opens different development checkouts concurrently", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-checkouts-")
  );
  const firstRoot = pathModule.join(temporary, "first");
  const secondRoot = pathModule.join(temporary, "second");
  const homeDirectory = pathModule.join(temporary, "home");
  let first: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let second: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    first = await openDevelopmentSession({
      appRoot: firstRoot,
      environment: {},
      homeDirectory,
    });
    second = await openDevelopmentSession({
      appRoot: secondRoot,
      environment: {},
      homeDirectory,
    });

    expect(first.profile.controlDirectory).not.toBe(
      second.profile.controlDirectory
    );
    expect(first.profile.portlessPort).not.toBe(second.profile.portlessPort);
  } finally {
    await second?.close();
    await first?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("reuses the development proxy port between sessions", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-recovery-")
  );
  const homeDirectory = pathModule.join(temporary, "home");
  const appRoot = realpathSync(".");
  let initial: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let recovered: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    initial = await openDevelopmentSession({
      appRoot,
      environment: {},
      homeDirectory,
    });
    const initialPort = initial.profile.portlessPort;
    await initial.close();
    initial = undefined;
    recovered = await openDevelopmentSession({
      appRoot,
      environment: {},
      homeDirectory,
    });

    expect(recovered.profile.portlessPort).toBe(initialPort);
  } finally {
    await recovered?.close();
    await initial?.close();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("does not silently change a remembered development proxy port", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-stable-port-")
  );
  const options = {
    appRoot: realpathSync("."),
    environment: {},
    homeDirectory: pathModule.join(temporary, "home"),
  };
  let closeOccupiedPort: (() => Promise<void>) | undefined;
  let initial: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;
  let reopened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    initial = await openDevelopmentSession(options);
    const port = initial.profile.portlessPort;
    await initial.close();
    initial = undefined;
    closeOccupiedPort = await listenOnPort(port);

    await expect(openDevelopmentSession(options)).rejects.toThrow(
      `Portless proxy port ${port} is already in use`
    );
    await closeOccupiedPort();
    closeOccupiedPort = undefined;
    reopened = await openDevelopmentSession(options);
    expect(reopened.profile.portlessPort).toBe(port);
  } finally {
    await reopened?.close();
    await initial?.close();
    await closeOccupiedPort?.();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects changing the explicit proxy port for existing state", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-port-change-")
  );
  const firstPort = await reserveBackingPort();
  const secondPort = await reserveBackingPort(new Set([firstPort.port]));
  const options = {
    appRoot: realpathSync("."),
    homeDirectory: pathModule.join(temporary, "home"),
  };
  let initial: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    await firstPort.release();
    initial = await openDevelopmentSession({
      ...options,
      environment: { BRANCHBASE_PORTLESS_PORT: String(firstPort.port) },
    });
    await initial.close();
    initial = undefined;
    await secondPort.release();

    await expect(
      openDevelopmentSession({
        ...options,
        environment: { BRANCHBASE_PORTLESS_PORT: String(secondPort.port) },
      })
    ).rejects.toThrow(
      `development state uses Portless proxy port ${firstPort.port}`
    );
  } finally {
    await initial?.close();
    await secondPort.release();
    await firstPort.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("rejects an occupied explicit development proxy port", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-development-conflict-")
  );
  const reservation = await reserveBackingPort();
  const options = {
    appRoot: realpathSync("."),
    environment: {
      BRANCHBASE_PORTLESS_PORT: String(reservation.port),
    },
    homeDirectory: pathModule.join(temporary, "home"),
  };
  let opened: Awaited<ReturnType<typeof openDevelopmentSession>> | undefined;

  try {
    await expect(openDevelopmentSession(options)).rejects.toThrow(
      `Portless proxy port ${reservation.port} is already in use`
    );
    opened = await openDevelopmentSession({
      ...options,
      environment: {},
    });
    expect(opened.profile.portlessPort).not.toBe(reservation.port);
    await reservation.release();
  } finally {
    await opened?.close();
    await reservation.release();
    rmSync(temporary, { force: true, recursive: true });
  }
});
