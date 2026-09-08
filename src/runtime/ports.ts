import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import pathModule from "node:path";

const LINE_BREAK = /\r?\n/u;
const PORT_AT_END = /:(?<port>\d+)(?:\s|$)/u;

interface PortSnapshot {
  pidsByPort: Map<number, Set<number>>;
}

const runLsof = (args: string[]): string => {
  const result = spawnSync("lsof", args, {
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.status === 0 ? (result.stdout ?? "") : "";
};

const canonical = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export const pathInside = (path: string, root: string): boolean => {
  const candidate = pathModule.relative(canonical(root), canonical(path));
  return (
    candidate === "" ||
    !(candidate.startsWith("..") || pathModule.isAbsolute(candidate))
  );
};

const processCwd = (pid: number): string | null => {
  const output = runLsof(["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  const line = output.split(LINE_BREAK).find((value) => value.startsWith("n"));
  return line ? line.slice(1) : null;
};

export const pidOwnedByWorktree = (
  pid: number,
  worktreePath: string
): boolean => {
  const cwd = processCwd(pid);
  return cwd !== null && pathInside(cwd, worktreePath);
};

export const inspectListeningPorts = (): PortSnapshot => {
  const output = runLsof(["-nP", "-sTCP:LISTEN", "-iTCP", "-Fpn"]);
  const pidsByPort = new Map<number, Set<number>>();
  let currentPid: number | null = null;

  for (const line of output.split(LINE_BREAK)) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
      continue;
    }
    if (!line.startsWith("n") || currentPid === null) {
      continue;
    }
    const match = line.match(PORT_AT_END);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    const pids = pidsByPort.get(port) ?? new Set<number>();
    pids.add(currentPid);
    pidsByPort.set(port, pids);
  }
  return { pidsByPort };
};

export const portOwnership = (
  snapshot: PortSnapshot,
  port: number,
  worktreePath: string
): "owned" | "foreign" | "none" => {
  const pids = snapshot.pidsByPort.get(port);
  if (!pids || pids.size === 0) {
    return "none";
  }
  for (const pid of pids) {
    const cwd = processCwd(pid);
    if (cwd && pathInside(cwd, worktreePath)) {
      return "owned";
    }
  }
  return "foreign";
};

export const listeningPortPids = (
  snapshot: PortSnapshot,
  port: number
): number[] =>
  [...(snapshot.pidsByPort.get(port) ?? [])].toSorted(
    (left, right) => left - right
  );

export const ownedPortPids = (
  snapshot: PortSnapshot,
  ports: readonly number[],
  worktreePath: string
): number[] => {
  const owned = new Set<number>();
  for (const port of ports) {
    for (const pid of snapshot.pidsByPort.get(port) ?? []) {
      const cwd = processCwd(pid);
      if (cwd && pathInside(cwd, worktreePath)) {
        owned.add(pid);
      }
    }
  }
  return [...owned];
};
