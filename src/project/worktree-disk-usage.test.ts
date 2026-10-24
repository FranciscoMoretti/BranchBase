import { expect, spyOn, test } from "bun:test";

import { WorktreeDiskUsageCache } from "./worktree-disk-usage";

test("disk scans return immediately, deduplicate, cap concurrency, and refresh explicitly", async () => {
  const jobs = new Map<string, PromiseWithResolvers<number>>();
  const started: string[] = [];
  const cache = new WorktreeDiskUsageCache((path) => {
    started.push(path);
    const job = Promise.withResolvers<number>();
    jobs.set(path, job);
    return job.promise;
  });
  try {
    expect(cache.read("a").state).toBe("pending");
    cache.read("a", true);
    cache.read("b");
    cache.read("c");
    expect(started).toEqual(["a", "b"]);
    jobs.get("a")?.resolve(4096);
    await Promise.resolve();
    expect(started).toEqual(["a", "b", "c"]);
    expect(cache.read("a")).toMatchObject({ bytes: 4096, state: "ready" });
    jobs.get("b")?.reject(new Error("Permission denied"));
    await Promise.resolve();
    expect(cache.read("b")).toMatchObject({
      bytes: null,
      state: "unavailable",
    });
    expect(cache.read("a", true).state).toBe("pending");
    expect(started).toEqual(["a", "b", "c", "a"]);
  } finally {
    cache.close();
    for (const job of jobs.values()) {
      job.resolve(0);
    }
  }
});

test("scan admission is bounded and queued work expires when no longer viewed", async () => {
  const started: string[] = [];
  const jobs: PromiseWithResolvers<number>[] = [];
  const cache = new WorktreeDiskUsageCache((path) => {
    started.push(path);
    const job = Promise.withResolvers<number>();
    jobs.push(job);
    return job.promise;
  });
  const now = spyOn(Date, "now").mockReturnValue(1000);
  try {
    for (let index = 0; index < 1000; index += 1) {
      cache.read(String(index));
    }
    expect(started).toHaveLength(2);
    // Finish admitted scans: only 64 queued folders can follow the active two.
    for (let index = 0; index < 66; index += 1) {
      jobs[index]?.resolve(1024);
      // oxlint-disable-next-line no-await-in-loop -- Complete each scan before observing admission or eviction of the next.
      await Promise.resolve();
    }
    expect(started).toHaveLength(66);
    cache.read("active-a");
    cache.read("active-b");
    cache.read("abandoned");
    cache.read("still-viewed");
    now.mockReturnValue(32_001);
    cache.read("still-viewed");
    jobs[66]?.resolve(1024);
    await Promise.resolve();
    expect(started).not.toContain("abandoned");
    expect(started).toContain("still-viewed");
  } finally {
    now.mockRestore();
    cache.close();
    for (const job of jobs) {
      job.resolve(0);
    }
  }
});

test("completed folder measurements are evicted to bound cache retention", async () => {
  const measured: string[] = [];
  const cache = new WorktreeDiskUsageCache((path) => {
    measured.push(path);
    return Promise.resolve(1024);
  });
  try {
    for (let index = 0; index < 513; index += 1) {
      cache.read(String(index));
      // oxlint-disable-next-line no-await-in-loop -- Complete each scan before observing admission or eviction of the next.
      await Promise.resolve();
    }
    expect(cache.read("512").state).toBe("ready");
    expect(cache.read("0").state).toBe("pending");
    expect(measured.filter((path) => path === "0")).toHaveLength(2);
  } finally {
    cache.close();
  }
});

test("closing cancels active scans without starting queued scans", async () => {
  const signals: AbortSignal[] = [];
  const completion: PromiseWithResolvers<number> = Promise.withResolvers();
  const cache = new WorktreeDiskUsageCache((_path, signal) => {
    signals.push(signal);
    return completion.promise;
  });
  cache.read("a");
  cache.read("b");
  cache.read("c");
  cache.close();
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  completion.resolve(1);
  await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(cache.read("a").state).toBe("unavailable");
});
