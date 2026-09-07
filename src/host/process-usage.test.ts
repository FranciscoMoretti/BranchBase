import { expect, test } from "bun:test";
import { parseProcessSamples, processTreeUsage } from "./process-usage";

test("resource snapshots reject invalid rows and convert RSS from KiB", () => {
  expect(
    parseProcessSamples(" 10 1 1024 12.5\ninvalid\n11 10 -5 1\n12 10 256 0")
  ).toEqual([
    { pid: 10, parentPid: 1, memoryBytes: 1_048_576, cpuPercent: 12.5 },
    { pid: 12, parentPid: 10, memoryBytes: 262_144, cpuPercent: 0 },
  ]);
});
test("process trees count descendants once even when roots overlap and exclude unrelated processes", () => {
  const samples = parseProcessSamples(
    "10 1 100 2\n11 10 200 3\n12 11 300 4\n99 1 999 99"
  );
  expect(processTreeUsage(samples, [10, 11, 10])).toEqual({
    memoryBytes: 600 * 1024,
    cpuPercent: 9,
    processCount: 3,
  });
  expect(processTreeUsage(null, [10])).toBeNull();
  expect(processTreeUsage(samples, [])).toEqual({
    memoryBytes: 0,
    cpuPercent: 0,
    processCount: 0,
  });
});
