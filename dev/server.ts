import pathModule from "node:path";

import { createBranchBaseServer } from "../src/adapters/http/branchbase-server";
import { WorkspaceController } from "../src/application/workspace-controller";
import { openDevelopmentSession } from "./development-session";

const appRoot = pathModule.dirname(import.meta.dirname);
const session = await openDevelopmentSession({ appRoot });
let server: Awaited<ReturnType<typeof createBranchBaseServer>> | undefined;

try {
  const activeServer = await createBranchBaseServer({
    appRoot,
    codexControlDirectory: session.profile.codexControlDirectory,
    controller: new WorkspaceController(undefined, session.controllerRuntime),
    development: true,
    host: "127.0.0.1",
    port: session.profile.dashboardPort,
  });
  server = activeServer;
  console.log(`BranchBase: ${await activeServer.listen()}`);

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await activeServer.close();
      } finally {
        await session.close();
      }
    })();
    return shutdownPromise;
  };
  const shutdownOnSignal = async (): Promise<void> => {
    try {
      await shutdown();
    } catch {
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdownOnSignal();
    });
  }
} catch (error) {
  try {
    await server?.close();
  } catch {
    // Preserve the startup failure after attempting every owned cleanup.
  }
  try {
    await session.close();
  } catch {
    // Preserve the startup failure after attempting every owned cleanup.
  }
  throw error;
}
