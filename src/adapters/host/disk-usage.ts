import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TOTAL = /^(?<kib>\d+)\s/u;

/** Allocated blocks, without following symlinks or crossing mounted filesystems. */
export const measureDirectoryDiskUsage = async (
  path: string,
  signal: AbortSignal
): Promise<number> => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("Disk measurement is available on macOS and Linux.");
  }
  const { stdout } = await execFileAsync("du", ["-sk", "-P", "-x", path], {
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024,
    signal,
    timeout: 30_000,
  });
  const match = TOTAL.exec(stdout);
  const bytes = Number(match?.groups?.kib) * 1024;
  if (!match || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Could not read the directory's disk usage.");
  }
  return bytes;
};
