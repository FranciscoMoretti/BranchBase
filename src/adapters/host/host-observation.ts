import { spawnSync } from "node:child_process";

import { parseProcessSamples } from "./process-usage";
import type { ProcessSample } from "./process-usage";

const LINES = /\r?\n/u;
const END_PORT = /:(?<port>\d+)$/u;
const WHITESPACE = /\s+/u;

export interface HostCommandResult {
  stdout: string;
  status: number | null;
  error?: unknown;
}

export interface HostObservationAdapter {
  run: (program: string, args: readonly string[]) => HostCommandResult;
}

export interface HostListener {
  pid: number;
  command: string;
  port: number;
  address: string;
}

export interface HostObservation {
  available: boolean;
  listeners: HostListener[];
  cwds: Map<number, string>;
  samples: ProcessSample[] | null;
  startedAt: Map<number, string>;
  warning: string | null;
}

const systemAdapter: HostObservationAdapter = {
  run(program, args) {
    const result = spawnSync(program, [...args], {
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 3000,
    });
    return {
      error: result.error,
      status: result.status,
      stdout: result.stdout ?? "",
    };
  },
};

export const parseListeners = (output: string): HostListener[] => {
  let command = "Process";
  let pid = 0;
  const rows: HostListener[] = [];
  for (const line of output.split(LINES)) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    }
    if (line.startsWith("c")) {
      command = line.slice(1);
    }
    if (line.startsWith("n")) {
      const match = line.match(END_PORT);
      const port = Number(match?.groups?.port);
      if (
        match &&
        Number.isSafeInteger(pid) &&
        pid > 0 &&
        port > 0 &&
        port <= 65_535
      ) {
        rows.push({ address: line.slice(1), command, pid, port });
      }
    }
  }
  return [
    ...new Map(rows.map((row) => [`${row.pid}:${row.port}`, row])).values(),
  ];
};

export const parseCwds = (output: string): Map<number, string> => {
  let pid = 0;
  const result = new Map<number, string>();
  for (const line of output.split(LINES)) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    }
    if (line.startsWith("n") && pid > 0) {
      result.set(pid, line.slice(1));
    }
  }
  return result;
};

export const parseStartedAt = (output: string): Map<number, string> => {
  const result = new Map<number, string>();
  for (const line of output.trim().split(LINES)) {
    const [pidText, ...date] = line.trim().split(WHITESPACE);
    const pid = Number(pidText);
    const time = Date.parse(date.join(" "));
    if (Number.isInteger(pid) && pid > 0 && Number.isFinite(time)) {
      result.set(pid, new Date(time).toISOString());
    }
  }
  return result;
};

const parseCombinedProcessRows = (
  output: string
): {
  samples: ProcessSample[];
  startedAt: Map<number, string>;
} => {
  const samples: ProcessSample[] = [];
  const startedAt = new Map<number, string>();
  for (const line of output.trim().split(LINES)) {
    const values = line.trim().split(WHITESPACE);
    const [pidText] = values;
    const pid = Number(pidText);
    if (values.length < 9 || !Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    const [sample] = parseProcessSamples(values.slice(0, 4).join(" "));
    if (sample) {
      samples.push(sample);
    }
    const time = Date.parse(values.slice(4).join(" "));
    if (Number.isFinite(time)) {
      startedAt.set(pid, new Date(time).toISOString());
    }
  }
  return { samples, startedAt };
};

/** Collect one bounded, internally consistent host observation. */
export const collectHostObservation = (
  adapter: HostObservationAdapter = systemAdapter
): HostObservation => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return {
      available: false,
      cwds: new Map(),
      listeners: [],
      samples: null,
      startedAt: new Map(),
      warning:
        "Host process inspection is currently supported on macOS and Linux.",
    };
  }
  const listenersResult = adapter.run("lsof", [
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
    "-Fpcn",
  ]);
  if (
    listenersResult.error ||
    (listenersResult.status !== 0 && listenersResult.status !== 1)
  ) {
    return {
      available: false,
      cwds: new Map(),
      listeners: [],
      samples: null,
      startedAt: new Map(),
      warning:
        "Could not inspect local listeners. Check process inspection permissions.",
    };
  }
  const listeners = parseListeners(listenersResult.stdout);
  const pids = [...new Set(listeners.map((row) => row.pid))];
  const cwdResult = pids.length
    ? adapter.run("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fn"])
    : { status: 0, stdout: "" };
  const processResult = adapter.run("ps", [
    "-axo",
    "pid=,ppid=,rss=,%cpu=,lstart=",
  ]);
  const combined =
    processResult.status === 0
      ? parseCombinedProcessRows(processResult.stdout)
      : null;
  const cwds = parseCwds(cwdResult.stdout ?? "");
  const samples = combined?.samples ?? null;
  const startedAt = combined?.startedAt ?? new Map<number, string>();
  const warning =
    cwds.size < pids.length
      ? "Some process working directories are unavailable."
      : null;
  return { available: true, cwds, listeners, samples, startedAt, warning };
};
