import { realpathSync } from "node:fs";

import type { DetectedService } from "../../project/discovery-contract";
import { collectHostObservation } from "./host-observation";
import { inspectProcessSamples, processTreeUsage } from "./process-usage";
import type { ProcessSample } from "./process-usage";

const POSITIVE_PROBE_TTL = 30_000;
export const NEGATIVE_PROBE_TTL_MS = 1000;
export const PROBE_TIMEOUT_MS = 700;
export { parseCwds, parseListeners } from "./host-observation";
const descendants = (samples: ProcessSample[] | null, roots: number[]) => {
  const owned = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sample of samples ?? []) {
      if (owned.has(sample.parentPid) && !owned.has(sample.pid)) {
        owned.add(sample.pid);
        changed = true;
      }
    }
  }
  return owned;
};
const evictProbes = (
  probes: Map<string, { at: number; url: string | null }>,
  now: number
) => {
  if (probes.size <= 1024) {
    return;
  }
  for (const [probeKey, probe] of probes) {
    const ttl = probe.url ? POSITIVE_PROBE_TTL : NEGATIVE_PROBE_TTL_MS;
    if (now - probe.at >= ttl) {
      probes.delete(probeKey);
    }
  }
  while (probes.size > 1024) {
    const entries = [...probes.entries()];
    const [first] = entries;
    if (!first) {
      return;
    }
    let oldest = first;
    for (const entry of entries.slice(1)) {
      const [, probe] = entry;
      const [, oldestProbe] = oldest;
      if (probe.at < oldestProbe.at) {
        oldest = entry;
      }
    }
    const [oldestKey] = oldest;
    probes.delete(oldestKey);
  }
};
/** Observation only. These PIDs are never authority to terminate a process. */
export class DetectedServices {
  private cached: {
    at: number;
    samples?: ProcessSample[] | null;
    services: DetectedService[];
    warning: string | null;
  } = { at: 0, services: [], warning: null };
  private readonly probes = new Map<
    string,
    { at: number; url: string | null }
  >();
  private activeProbes = 0;
  private managedKey = "";
  inspect(managedPids: number[]): {
    at: number;
    services: DetectedService[];
    warning: string | null;
    samples?: ProcessSample[] | null;
  } {
    const managedKey = managedPids.toSorted((a, b) => a - b).join(",");
    if (managedKey === this.managedKey && Date.now() - this.cached.at < 4000) {
      const samples = inspectProcessSamples();
      if (samples !== this.cached.samples) {
        this.cached = {
          ...this.cached,
          samples,
          services: this.cached.services.map((service) => ({
            ...service,
            resources: processTreeUsage(samples, [service.pid]),
          })),
        };
      }
      return this.cached;
    }
    this.managedKey = managedKey;
    if (process.platform !== "darwin" && process.platform !== "linux") {
      return {
        at: Date.now(),
        services: [],
        warning:
          "Detected services are currently supported on macOS and Linux.",
      };
    }
    const observation = collectHostObservation();
    if (observation.warning && observation.listeners.length === 0) {
      return { at: Date.now(), services: [], warning: observation.warning };
    }
    const parsedRows = observation.listeners;
    const rows = parsedRows.slice(0, 256);
    if (!rows.length) {
      this.cached = { at: Date.now(), services: [], warning: null };
      return this.cached;
    }
    const paths = observation.cwds;
    const samples = observation.samples ?? inspectProcessSamples();
    const times = observation.startedAt;
    const owned = descendants(samples, managedPids);
    const services: DetectedService[] = [];
    for (const row of rows) {
      const cwd = paths.get(row.pid);
      if (!cwd) {
        continue;
      }
      try {
        services.push({
          ...row,
          cwd: realpathSync(cwd),
          managed: owned.has(row.pid),
          resources: processTreeUsage(samples, [row.pid]),
          startedAt: times.get(row.pid) ?? null,
          url: null,
        });
      } catch {
        /* Process may exit during inspection. */
      }
    }
    let warning: string | null = observation.warning;
    if (paths.size < new Set(rows.map((row) => row.pid)).size) {
      warning = "Some process working directories are unavailable.";
    }
    if (parsedRows.length > rows.length) {
      const limitWarning = "Showing the first 256 listeners.";
      warning = [warning, limitWarning].filter(Boolean).join(" ") || null;
    }
    this.cached = { at: Date.now(), samples, services, warning };
    return this.cached;
  }
  webUrl(service: DetectedService): string | null {
    const { pid, port, cwd, address, command } = service;
    if (
      !(
        address.startsWith("*:") ||
        address.startsWith("127.0.0.1:") ||
        address.startsWith("[::1]:")
      )
    ) {
      return null;
    }
    const key = `${pid}:${port}:${cwd}:${command}:${service.startedAt}:${address}`;
    const cached = this.probes.get(key);
    const cacheTtl = cached?.url ? POSITIVE_PROBE_TTL : NEGATIVE_PROBE_TTL_MS;
    if (cached && Date.now() - cached.at < cacheTtl) {
      return cached.url;
    }
    if (this.activeProbes >= 4) {
      return cached?.url ?? null;
    }
    this.activeProbes += 1;
    this.probes.set(key, { at: Date.now(), url: cached?.url ?? null });
    const url = address.startsWith("[::1]:")
      ? `http://[::1]:${port}`
      : `http://127.0.0.1:${port}`;
    void (async () => {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        this.probes.set(key, {
          at: Date.now(),
          url: response.status > 0 ? url : null,
        });
        try {
          await response.body?.cancel();
        } catch {
          // Draining a probe response is best-effort.
        }
      } catch {
        this.probes.set(key, { at: Date.now(), url: null });
      } finally {
        this.activeProbes -= 1;
      }
    })();
    evictProbes(this.probes, Date.now());
    return cached?.url ?? null;
  }
}
