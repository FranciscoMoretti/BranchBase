import { expect, test } from "bun:test";

import { aggregateDiskUsage } from "./disk-usage";
import type { DiskUsage } from "./disk-usage-contract";

const measured = (bytes: number): DiskUsage => ({
  bytes,
  error: null,
  measuredAt: "2026-10-24T12:00:00Z",
  state: "ready",
});

test("project disk totals include every worktree and do not present incomplete scans as complete", () => {
  expect(aggregateDiskUsage([measured(1024), measured(2048)])).toMatchObject({
    bytes: 3072,
    state: "ready",
  });
  const pending: DiskUsage = {
    bytes: null,
    error: null,
    measuredAt: null,
    state: "pending",
  };
  expect(aggregateDiskUsage([measured(1024), pending])).toMatchObject({
    bytes: 1024,
    state: "pending",
  });
  expect(aggregateDiskUsage([pending])).toMatchObject({
    bytes: null,
    state: "pending",
  });
  expect(
    aggregateDiskUsage([measured(1024), { ...pending, state: "unavailable" }])
  ).toMatchObject({ bytes: 1024, state: "unavailable" });
  expect(aggregateDiskUsage([measured(2048)])).toMatchObject({
    bytes: 2048,
    state: "ready",
  });
});
