import { expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { PortlessRoutingEngine } from "./portless";
import { startProxyProcess } from "./proxy-process";

const require = createRequire(import.meta.url);
const packageFile = (name: string, ...parts: string[]) =>
  path.join(path.dirname(require.resolve(`${name}/package.json`)), ...parts);

const controlledProcess = (): number => {
  const background = spawnSync("sh", ["-c", "sleep 30 & echo $!"], {
    encoding: "utf-8",
  });
  const pid = Number(background.stdout.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Could not identify controlled process");
  }
  return pid;
};

const processMarker = (pid: number): string =>
  spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf-8",
  }).stdout.trim();

const freePort = async (): Promise<{
  port: number;
  server: ReturnType<typeof createServer>;
}> => {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve port");
  }
  return { port: address.port, server };
};

it("fails closed when a live proxy has missing or mismatched ownership metadata", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "branchbase-proxy-owner-"));
  const pid = controlledProcess();
  try {
    writeFileSync(path.join(directory, "proxy.pid"), `${pid}\n`);
    const routing = new PortlessRoutingEngine({ stateDirectory: directory });

    await expect(routing.prepare()).rejects.toThrow(
      "ownership could not be verified"
    );
    expect(() => process.kill(pid, 0)).not.toThrow();
    writeFileSync(
      path.join(directory, "branchbase-runtime.json"),
      JSON.stringify({
        pid: pid + 1,
        port: routing.port,
        processStartMarker: processMarker(pid),
        version: 1,
      })
    );
    await expect(routing.prepare()).rejects.toThrow(
      "ownership could not be verified"
    );
    expect(() => process.kill(pid, 0)).not.toThrow();
  } finally {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The controlled process may already have exited.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

it("does not remove foreign metadata when proxy startup loses a port race", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "branchbase-proxy-conflict-")
  );
  const foreignPid = controlledProcess();
  const { port, server } = await freePort();
  const pidPath = path.join(directory, "proxy.pid");
  const markerPath = path.join(directory, "branchbase-runtime.json");
  const foreignMarker = JSON.stringify({ owner: "foreign", pid: foreignPid });
  writeFileSync(pidPath, `${foreignPid}\n`);
  writeFileSync(markerPath, foreignMarker);
  try {
    await expect(
      startProxyProcess({
        nodePath: packageFile("node", "bin", "node"),
        port,
        stateDirectory: directory,
      })
    ).rejects.toThrow();
    expect(readFileSync(pidPath, "utf-8")).toBe(`${foreignPid}\n`);
    expect(readFileSync(markerPath, "utf-8")).toBe(foreignMarker);
    expect(existsSync(path.join(directory, "proxy.port"))).toBe(false);
  } finally {
    server.close();
    try {
      process.kill(foreignPid, "SIGTERM");
    } catch {
      // The controlled process may already have exited.
    }
    rmSync(directory, { force: true, recursive: true });
  }
}, 10_000);
