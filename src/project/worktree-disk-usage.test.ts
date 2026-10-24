import { expect, test } from "bun:test";

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
