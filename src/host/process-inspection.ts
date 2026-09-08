import { spawnSync } from "node:child_process";

export const processStartMarker = (pid: number): string => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf-8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
};

export const processIsLive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "EPERM") {
      return true;
    }
    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
};
