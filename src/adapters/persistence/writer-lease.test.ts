import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { acquireWriterLease } from "./writer-lease";

test("one daemon owns a control directory until its lease is released", () => {
  const directory = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-writer-")
  );
  const release = acquireWriterLease(directory);
  try {
    expect(() => acquireWriterLease(directory)).toThrow(
      "Another BranchBase daemon"
    );
    release();
    const nextRelease = acquireWriterLease(directory);
    nextRelease();
    nextRelease();
  } finally {
    release();
    rmSync(directory, { force: true, recursive: true });
  }
});
