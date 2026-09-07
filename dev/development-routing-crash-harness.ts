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

process.once("disconnect", () => {
  exit().catch(() => process.exit(1));
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    exit().catch(() => process.exit(1));
  });
}
