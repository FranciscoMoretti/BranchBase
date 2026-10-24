import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { measureDirectoryDiskUsage } from "./disk-usage";

test("disk usage includes hidden build files but does not follow external symlinks", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "branchbase-disk-"));
  const folder = path.join(root, "checkout with spaces");
  const external = path.join(root, "shared-cache");
  mkdirSync(folder);
  mkdirSync(external);
  const { signal } = new AbortController();
  try {
    const empty = await measureDirectoryDiskUsage(folder, signal);
    writeFileSync(path.join(folder, ".build"), Buffer.alloc(1024 * 1024, 42));
    writeFileSync(
      path.join(external, "large"),
      Buffer.alloc(8 * 1024 * 1024, 17)
    );
    symlinkSync(external, path.join(folder, "cache"));
    const measured = await measureDirectoryDiskUsage(folder, signal);
    expect(measured).toBeGreaterThan(empty);
    expect(measured).toBeLessThan(2 * 1024 * 1024);
    await expect(
      measureDirectoryDiskUsage(path.join(root, "missing"), signal)
    ).rejects.toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
