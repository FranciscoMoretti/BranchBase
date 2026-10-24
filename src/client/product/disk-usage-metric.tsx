import type { DiskUsage } from "../../project/disk-usage-contract";
import { formatBytes } from "./resource-format";

const diskLabel = (usage: DiskUsage | undefined): string => {
  if (!usage) {
    return "Disk unavailable";
  }
  if (usage.bytes === null) {
    return usage.state === "pending" ? "Disk measuring…" : "Disk unavailable";
  }
  const size = formatBytes(usage.bytes);
  if (usage.state === "pending") {
    return `Disk ${size} · updating`;
  }
  if (usage.state === "unavailable") {
    return `Disk ${size} · incomplete`;
  }
  return `Disk ${size}`;
};

export const DiskUsageMetric = ({
  usage,
  aggregate = false,
}: {
  usage?: DiskUsage;
  aggregate?: boolean;
}) => (
  <span
    className="product-muted text-xs whitespace-nowrap"
    title={[
      aggregate
        ? "Total folder storage across this project's worktrees, including the primary worktree and shared Git data."
        : "Storage inside this worktree folder, including dependencies, build output, and ignored files.",
      "Shared files or nested worktrees may be counted more than once. Space freed by deletion may differ. External caches and container volumes are not included.",
      usage?.measuredAt
        ? `Measured ${new Date(usage.measuredAt).toLocaleString()}. Updates automatically every five minutes while viewed.`
        : "Measured in the background.",
      usage?.error,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {diskLabel(usage)}
  </span>
);
