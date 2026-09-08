import { DevelopmentRouting } from "./development-routing";

const port = Number(process.argv[2]);
const [stateDirectory] = process.argv.slice(3);
if (!(Number.isInteger(port) && stateDirectory)) {
  throw new Error("Invalid development routing harness configuration");
}

const routing = await DevelopmentRouting.open({ port, stateDirectory });
process.send?.({ type: "ready" });

const exit = async (): Promise<void> => {
  await routing.close();
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
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void exitOnFailure();
  });
}
