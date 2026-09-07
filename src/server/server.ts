import pathModule from "node:path";

import { createBranchBaseServer } from "./branchbase-server";

const appRoot = pathModule.dirname(pathModule.dirname(import.meta.dirname));
const server = await createBranchBaseServer({
  appRoot,
  ...(process.env.BRANCHBASE_CODEX_CONTROL_DIR
    ? { codexControlDirectory: process.env.BRANCHBASE_CODEX_CONTROL_DIR }
    : {}),
  development: false,
  host: "127.0.0.1",
  port: Number(process.env.BRANCHBASE_PORT ?? 3999),
});

console.log(`BranchBase: ${await server.listen()}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
