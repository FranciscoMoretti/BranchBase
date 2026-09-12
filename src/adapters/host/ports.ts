import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import pathModule from "node:path";

import { collectHostObservation } from "./host-observation";
import type { ProcessSample } from "./process-usage";

const PORT_AT_END = /:(?<port>\d+)(?:\s|$)/u;

export interface PortSnapshot {
  pidsByPort: Map<number, Set<number>>;
  /** Cwds captured with the listener query; display observations must not probe N+1. */
  cwdsByPid?: Map<number, string>;
  samples?: ProcessSample[] | null;
}

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
  const result = spawnSync(
    "lsof",
    ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
    {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 3000,
    }
  );
  if (result.status !== 0) {
    return null;
  }
  const line = (result.stdout ?? "")
    .split(/\r?\n/u)
    .find((value: string) => value.startsWith("n"));
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
  const observation = collectHostObservation();
  if (!observation.available) {
    throw new Error(
      observation.warning ?? "Could not inspect local listeners."
    );
  }
  const pidsByPort = new Map<number, Set<number>>();
  for (const row of observation.listeners) {
    const match = row.address.match(PORT_AT_END);
    if (!match) {
      continue;
    }
    const port = Number(match.groups?.port);
    const pids = pidsByPort.get(port) ?? new Set<number>();
    pids.add(row.pid);
    pidsByPort.set(port, pids);
  }
  return {
    cwdsByPid: observation.cwds,
    pidsByPort,
    samples: observation.samples,
  };
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
    const cwd = snapshot.cwdsByPid?.get(pid);
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
      const cwd = snapshot.cwdsByPid?.get(pid);
      if (cwd && pathInside(cwd, worktreePath)) {
        owned.add(pid);
      }
    }
  }
  return [...owned];
};
