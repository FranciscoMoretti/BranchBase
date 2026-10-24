import type { DiskUsage } from "./disk-usage-contract";

/** Sum folder estimates; shared physical storage is not deduplicated. */
export const aggregateDiskUsage = (values: DiskUsage[]): DiskUsage => {
  const measured = values.filter((value) => value.bytes !== null);
  let state: DiskUsage["state"] = "ready";
  if (values.some((value) => value.state === "pending")) {
    state = "pending";
  } else if (values.some((value) => value.state === "unavailable")) {
    state = "unavailable";
  }
  const dates = measured
    .flatMap((value) => (value.measuredAt ? [value.measuredAt] : []))
    .toSorted();
  return {
    bytes:
      measured.length || values.length === 0
        ? measured.reduce((sum, value) => sum + (value.bytes ?? 0), 0)
        : null,
    error:
      state === "unavailable"
        ? "Some worktree folders could not be measured."
        : null,
    measuredAt: dates[0] ?? null,
    state,
  };
};
