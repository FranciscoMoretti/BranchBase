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
const SAMPLE_CACHE_TTL = 250;
let cachedSamples: { at: number; samples: ProcessSample[] | null } | null =
  null;
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
      return [{ cpuPercent, memoryBytes: rss * 1024, parentPid, pid }];
    });
}
/**
 * Read-only observations; never evidence for process ownership or termination.
 * CPU is the platform's decaying/lifetime `ps %cpu` average, not an instant
 * measurement. Results are cached briefly because this synchronous probe blocks.
 */
export function inspectProcessSamples(): ProcessSample[] | null {
  const now = Date.now();
  if (cachedSamples && now - cachedSamples.at < SAMPLE_CACHE_TTL) {
    return cachedSamples.samples;
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return null;
  }
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,%cpu="], {
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 2000,
  });
  const samples =
    result.status === 0 ? parseProcessSamples(result.stdout) : null;
  cachedSamples = { at: Date.now(), samples };
  return samples;
}
/** RSS totals are an additive approximation and may double-count shared pages. */
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
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryBytes,
    processCount: seen.size,
  };
}
