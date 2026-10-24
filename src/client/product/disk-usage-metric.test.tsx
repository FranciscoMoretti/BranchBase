import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DiskUsageMetric } from "./disk-usage-metric";
import { ResourceUsage } from "./primitives";

test("inline disk, RAM, and CPU metrics label their resource and incomplete totals", () => {
  const disk = {
    bytes: 1024 ** 3,
    error: null,
    measuredAt: "2026-10-24T12:00:00Z",
    state: "ready" as const,
  };
  const html = renderToStaticMarkup(<DiskUsageMetric usage={disk} aggregate />);
  expect(html).toContain("Disk 1.0 GiB");
  expect(html).toContain("Total folder storage");
  expect(html).not.toContain("button");
  expect(
    renderToStaticMarkup(
      <DiskUsageMetric usage={{ ...disk, state: "pending" }} aggregate />
    )
  ).toContain("Disk 1.0 GiB · updating");
  expect(
    renderToStaticMarkup(
      <DiskUsageMetric usage={{ ...disk, bytes: null, state: "unavailable" }} />
    )
  ).toContain("Disk unavailable");
  expect(
    renderToStaticMarkup(
      <ResourceUsage
        usage={{ cpuPercent: 12, memoryBytes: 1024 ** 3, processCount: 1 }}
      />
    )
  ).toContain("RAM 1.0 GiB · CPU 12.0%");
});
