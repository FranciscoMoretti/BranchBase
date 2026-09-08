import { spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
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

import { delay } from "../src/runtime/async-utils";

const PROJECT_ROOT = pathModule.resolve(import.meta.filename, "../..");

interface CommandOptions {
  allowFailure?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

const run = (
  command: string,
  args: string[],
  options: CommandOptions = {}
): string => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...options.env },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  }
  return output;
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const unusedPort = async (): Promise<number> => {
  const server = createServer();
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert(address && typeof address !== "string", "Could not reserve a port");
  const { port } = address;
  const closed = once(server, "close");
  server.close();
  await closed;
  return port;
};

const waitUntilStopped = async (url: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Packed daemon shutdown polling observes each attempt before waiting.
      await fetch(url);
    } catch {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Packed daemon shutdown polling observes each attempt before waiting.
    await delay(100);
  }
  throw new Error("Packed BranchBase daemon did not stop");
};

const temporaryRoot = mkdtempSync(
  pathModule.join(tmpdir(), "branchbase-pack-")
);
const packDirectory = pathModule.join(temporaryRoot, "pack");
const installDirectory = pathModule.join(temporaryRoot, "consumer");
const fixtureDirectory = pathModule.join(temporaryRoot, "repository");
const homeDirectory = pathModule.join(temporaryRoot, "home");
let cliPath = "";
let daemonEnvironment: Record<string, string> = {};

try {
  mkdirSync(installDirectory);
  const tarballName = "branchbase.tgz";
  mkdirSync(packDirectory);
  const tarballPath = pathModule.join(packDirectory, tarballName);
  run("bun", ["pm", "pack", "--filename", tarballPath, "--quiet"]);
  assert(existsSync(tarballPath), "bun pm pack did not create the tarball");

  const packedFiles = run("tar", ["-tzf", tarballPath]);
  for (const requiredPath of [
    "package/scripts/daemon.ts",
    "package/dist/index.html",
    "package/plugins/branchbase/.codex-plugin/plugin.json",
    "package/plugins/branchbase/hooks/hooks.json",
    "package/plugins/branchbase/hooks/branchbase-hook",
    "package/plugins/branchbase/hooks/branchbase-hook.ts",
    "package/schema/branchbase.schema.json",
    "package/src/config/public.ts",
  ]) {
    assert(
      packedFiles.split("\n").includes(requiredPath),
      `Packed artifact is missing ${requiredPath}`
    );
  }
  assert(
    !packedFiles.split("\n").some((path) => path.startsWith("package/dev/")),
    "Packed artifact unexpectedly includes contributor development tooling"
  );

  writeFileSync(
    pathModule.join(installDirectory, "package.json"),
    '{"name":"branchbase-pack-consumer","private":true,"type":"module"}\n',
    { flag: "wx" }
  );
  run("bun", ["add", "--ignore-scripts", tarballPath], {
    cwd: installDirectory,
  });
  cliPath = pathModule.join(
    installDirectory,
    "node_modules",
    ".bin",
    "branchbase"
  );
  assert(
    existsSync(cliPath),
    "Packed install did not expose the branchbase CLI"
  );
  run(
    "bun",
    [
      "-e",
      'import { BranchBaseConfigSchema } from "branchbase/config"; const config = BranchBaseConfigSchema.parse({ version: 1, setup: { argv: ["bun", "install"] }, appGroups: { Apps: { start: { argv: ["bun", "run", "dev"] }, stop: "process", env: { PORT: "{apps.web.port}" }, apps: { web: { protocol: "http", readiness: "tcp" } } } } }); if (config.appGroups.Apps.apps.web.protocol !== "http") process.exit(1);',
    ],
    { cwd: installDirectory }
  );

  run("git", ["init", "--quiet", fixtureDirectory]);
  run("git", ["config", "user.email", "pack-smoke@branchbase.local"], {
    cwd: fixtureDirectory,
  });
  run("git", ["config", "user.name", "BranchBase Pack Smoke"], {
    cwd: fixtureDirectory,
  });
  writeFileSync(pathModule.join(fixtureDirectory, "README.md"), "# Fixture\n");
  writeFileSync(
    pathModule.join(fixtureDirectory, ".branchbase.json"),
    `${JSON.stringify(
      {
        appGroups: {
          Apps: {
            apps: {
              fixture: { protocol: "http", readiness: "tcp" },
            },
            env: { PORT: "{apps.fixture.port}" },
            start: { argv: ["bun", "run", "dev"] },
            stop: "process",
          },
        },
        setup: { argv: ["bun", "install"] },
        version: 1,
      },
      null,
      2
    )}\n`
  );
  run("git", ["add", "."], { cwd: fixtureDirectory });
  run("git", ["commit", "--quiet", "-m", "Create smoke fixture"], {
    cwd: fixtureDirectory,
  });

  const port = await unusedPort();
  daemonEnvironment = {
    BRANCHBASE_NO_OPEN: "1",
    BRANCHBASE_PORT: String(port),
    HOME: homeDirectory,
  };
  const startOutput = run(cliPath, ["start", "--repo", fixtureDirectory], {
    cwd: installDirectory,
    env: daemonEnvironment,
  });
  assert(
    startOutput.includes("BranchBase started"),
    "Packed CLI did not start"
  );
  assert(
    run(cliPath, ["status"], {
      cwd: installDirectory,
      env: daemonEnvironment,
    }).includes("BranchBase is running"),
    "Packed CLI status did not report the daemon"
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetch(`${baseUrl}/api/health`);
  const healthBody = (await health.json()) as { service?: string };
  assert(
    health.ok && healthBody.service === "branchbase",
    "Packed daemon health check failed"
  );
  const workspace = await fetch(
    `${baseUrl}/api/workspace?${new URLSearchParams({ repoPath: fixtureDirectory })}`
  );
  const workspaceBody = (await workspace.json()) as { repoPath?: string };
  assert(
    workspace.ok && workspaceBody.repoPath === realpathSync(fixtureDirectory),
    "Packed daemon did not inspect the disposable Git fixture"
  );
  const ui = await fetch(`${baseUrl}/`);
  const uiHtml = await ui.text();
  assert(
    ui.ok && uiHtml.includes("/assets/"),
    "Packed daemon did not serve the production UI"
  );
  const assetPath = uiHtml.match(
    /(?:src|href)="(?<assetPath>\/assets\/[^"]+)"/u
  )?.groups?.assetPath;
  assert(assetPath, "Packed production UI did not reference a built asset");
  const assetResponse = await fetch(`${baseUrl}${assetPath}`);
  assert(assetResponse.ok, "Packed daemon did not serve its built UI asset");

  assert(
    run(cliPath, ["stop"], {
      cwd: installDirectory,
      env: daemonEnvironment,
    }).includes("BranchBase stopped"),
    "Packed CLI did not stop"
  );
  await waitUntilStopped(`${baseUrl}/api/health`);
  const stoppedStatus = run(cliPath, ["status"], {
    allowFailure: true,
    cwd: installDirectory,
    env: daemonEnvironment,
  });
  assert(
    stoppedStatus.includes("BranchBase is stopped"),
    "Packed CLI status did not report the stopped daemon"
  );

  const daemonLog = readFileSync(
    pathModule.join(homeDirectory, ".branchbase", "server.log"),
    "utf-8"
  );
  assert(
    !daemonLog.includes("VITE"),
    "Packed daemon unexpectedly started the Vite development server"
  );
  console.log(
    "Packed BranchBase artifact passed install and daemon smoke tests"
  );
} finally {
  if (cliPath) {
    run(cliPath, ["stop"], {
      allowFailure: true,
      cwd: installDirectory,
      env: daemonEnvironment,
    });
  }
  rmSync(temporaryRoot, { force: true, recursive: true });
}
