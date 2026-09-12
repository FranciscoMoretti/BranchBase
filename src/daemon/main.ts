import pathModule from "node:path";

import { createDaemon } from "./bootstrap";

const appRoot = pathModule.dirname(pathModule.dirname(import.meta.dirname));
const server = await createDaemon({
  appRoot,
  ...(process.env.BRANCHBASE_CODEX_CONTROL_DIR
    ? { codexControlDirectory: process.env.BRANCHBASE_CODEX_CONTROL_DIR }
    : {}),
  development: false,
  host: "127.0.0.1",
  port: Number(process.env.BRANCHBASE_PORT ?? 3999),
});

console.log(`BranchBase: ${await server.listen()}`);

const closeOnSignal = async (): Promise<void> => {
  try {
    await server.close();
  } catch {
    process.exitCode = 1;
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeOnSignal();
  });
}
