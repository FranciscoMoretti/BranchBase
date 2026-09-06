import { spawnSync } from "node:child_process";

export interface ProcessUsage {
  cpuPercent: number;
  memoryBytes: number;
  processCount: number;
}
export interface ProcessSample {
  cpuPercent: number;
  memoryBytes: number;
  parentPid: number;
  pid: number;
}
const WHITESPACE = /\s+/;
const LINE_BREAK = /\r?\n/;
export function parseProcessSamples(output: string): ProcessSample[] {
  return output
    .trim()
    .split(LINE_BREAK)
    .flatMap((line) => {
      const values = line.trim().split(WHITESPACE).map(Number);
      const [pid, parentPid, rss, cpuPercent] = values;
      if (
        values.length !== 4 ||
        !values.every(Number.isFinite) ||
        !Number.isInteger(pid) ||
        pid <= 0 ||
        !Number.isInteger(parentPid) ||
        parentPid < 0 ||
        rss < 0 ||
        cpuPercent < 0
      ) {
        return [];
      }
      return [{ pid, parentPid, memoryBytes: rss * 1024, cpuPercent }];
    });
}
/** Read-only observations; never evidence for process ownership or termination. */
export function inspectProcessSamples(): ProcessSample[] | null {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return null;
  }
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.status === 0 ? parseProcessSamples(result.stdout) : null;
}
export function processTreeUsage(
  samples: ProcessSample[] | null,
  roots: number[]
): ProcessUsage | null {
  if (samples === null) {
    return null;
  }
  const children = new Map<number, ProcessSample[]>();
  const byPid = new Map(samples.map((sample) => [sample.pid, sample]));
  for (const sample of samples) {
    const siblings = children.get(sample.parentPid) ?? [];
    siblings.push(sample);
    children.set(sample.parentPid, siblings);
  }
  const seen = new Set<number>();
  const queue = [...roots];
  let memoryBytes = 0;
  let cpuPercent = 0;
  while (queue.length) {
    const pid = queue.pop();
    if (pid === undefined || seen.has(pid)) {
      continue;
    }
    const sample = byPid.get(pid);
    if (!sample) {
      continue;
    }
    seen.add(pid);
    memoryBytes += sample.memoryBytes;
    cpuPercent += sample.cpuPercent;
    queue.push(...(children.get(pid) ?? []).map((child) => child.pid));
  }
  return {
    memoryBytes,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    processCount: seen.size,
  };
}
