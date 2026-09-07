import { spawnSync } from "node:child_process";

export function inspectHttpStatus(url: string): number | null {
  const result = spawnSync(
    "curl",
    [
      "--silent",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--max-time",
      "0.5",
      url,
    ],
    { encoding: "utf-8", timeout: 1000 }
  );
  const status = Number(result.stdout);
  return result.status === 0 && Number.isInteger(status) ? status : null;
}
