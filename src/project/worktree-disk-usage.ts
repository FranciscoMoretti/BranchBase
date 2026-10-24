import type { DiskUsage } from "./disk-usage-contract";

interface Entry {
  at: number;
  requestedAt: number;
  controller: AbortController;
  result: DiskUsage;
}

/** Cached background scans. Disk traversal never blocks dashboard reads. */
export class WorktreeDiskUsageCache {
  private readonly entries = new Map<string, Entry>();
  private readonly queue = new Map<string, Entry>();
  private active = 0;
  private closed = false;

  private readonly measure: (
    path: string,
    signal: AbortSignal
  ) => Promise<number>;

  constructor(measure: (path: string, signal: AbortSignal) => Promise<number>) {
    this.measure = measure;
  }

  read(path: string, refresh = false): DiskUsage {
    const previous = this.entries.get(path);
    if (previous) {
      previous.requestedAt = Date.now();
    }
    if (
      previous &&
      (previous.result.state === "pending" ||
        (!refresh && Date.now() - previous.at < 300_000))
    ) {
      return previous.result;
    }
    if (this.closed) {
      return {
        bytes: null,
        error: "Disk scanner is stopped.",
        measuredAt: null,
        state: "unavailable",
      };
    }
    // Refuse excess work until the next read instead of growing an unbounded queue.
    if (this.queue.size >= 64) {
      return {
        bytes: previous?.result.bytes ?? null,
        error: null,
        measuredAt: previous?.result.measuredAt ?? null,
        state: "pending",
      };
    }
    if (this.entries.size >= 512) {
      for (const [key, entry] of this.entries) {
        if (entry.result.state !== "pending") {
          this.entries.delete(key);
          break;
        }
      }
    }
    const entry: Entry = {
      at: Date.now(),
      controller: new AbortController(),
      requestedAt: Date.now(),
      result: {
        bytes: previous?.result.bytes ?? null,
        error: null,
        measuredAt: previous?.result.measuredAt ?? null,
        state: "pending",
      },
    };
    this.entries.set(path, entry);
    this.queue.set(path, entry);
    this.drain();
    return entry.result;
  }

  forget(path: string): void {
    this.entries.get(path)?.controller.abort();
    this.entries.delete(path);
    this.queue.delete(path);
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
    }
    this.queue.clear();
    this.entries.clear();
  }

  private drain(): void {
    while (!this.closed && this.active < 2 && this.queue.size > 0) {
      const next = this.queue.entries().next().value;
      if (!next) {
        return;
      }
      const [path, entry] = next;
      this.queue.delete(path);
      if (Date.now() - entry.requestedAt > 30_000) {
        this.entries.delete(path);
        continue;
      }
      this.active += 1;
      void this.scan(path, entry);
    }
  }

  private async scan(path: string, entry: Entry): Promise<void> {
    try {
      const bytes = await this.measure(path, entry.controller.signal);
      entry.result = {
        bytes,
        error: null,
        measuredAt: new Date().toISOString(),
        state: "ready",
      };
    } catch {
      entry.result = {
        bytes: null,
        error:
          "Could not measure this folder. Check access; measurement retries automatically.",
        measuredAt: null,
        state: "unavailable",
      };
    } finally {
      entry.at = Date.now();
      this.active -= 1;
      this.drain();
    }
  }
}
