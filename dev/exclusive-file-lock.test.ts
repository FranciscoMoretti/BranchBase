import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { spawn } from "bun";

import {
  acquireExclusiveFileLock,
  ExclusiveFileLockBusyError,
} from "./exclusive-file-lock";

const readChunk = async (
  stream: ReadableStream<Uint8Array>
): Promise<string> => {
  const reader = stream.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = Promise.withResolvers<never>();
  try {
    timeout = setTimeout(
      () =>
        timeoutResult.reject(new Error("Timed out waiting for lock holder")),
      5000
    );
    const result = await Promise.race([reader.read(), timeoutResult.promise]);
    return new TextDecoder().decode(result.value);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    reader.releaseLock();
  }
};

it("holds an exclusive lock until its idempotent release", () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-exclusive-lock-")
  );
  const file = pathModule.join(temporary, "session.sqlite");

  try {
    const release = acquireExclusiveFileLock(file);
    expect(() => acquireExclusiveFileLock(file)).toThrow(
      ExclusiveFileLockBusyError
    );
    release();
    release();

    const releaseAgain = acquireExclusiveFileLock(file);
    releaseAgain();
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

it("releases the lock when its process crashes", async () => {
  const temporary = mkdtempSync(
    pathModule.join(tmpdir(), "branchbase-exclusive-lock-crash-")
  );
  const file = pathModule.join(temporary, "session.sqlite");
  const child = spawn({
    cmd: [
      process.execPath,
      "-e",
      `import { Database } from "bun:sqlite";
const database = new Database(${JSON.stringify(file)}, { create: true });
database.run("BEGIN IMMEDIATE");
console.log("locked");
setInterval(() => undefined, 60_000);`,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    expect(await readChunk(child.stdout)).toContain("locked");
    expect(() => acquireExclusiveFileLock(file)).toThrow(
      ExclusiveFileLockBusyError
    );
    child.kill("SIGKILL");
    await child.exited;

    const release = acquireExclusiveFileLock(file);
    release();
  } finally {
    child.kill("SIGKILL");
    await child.exited;
    rmSync(temporary, { force: true, recursive: true });
  }
});
