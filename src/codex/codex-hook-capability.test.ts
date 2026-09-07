import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { createCodexHookCapability } from "./codex-hook-capability";

describe("Codex hook capability", () => {
  it("rotates a private 256-bit token and removes only its own record", () => {
    const root = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-hook-capability-")
    );
    const directory = pathModule.join(root, "codex");
    try {
      const capability = createCodexHookCapability({
        directory,
        endpoint: "http://127.0.0.1:3999/api/codex/hooks",
        pid: 123,
        processStartMarker: "process-start",
      });
      const record = JSON.parse(readFileSync(capability.file, "utf-8"));

      expect(record).toEqual(capability.record);
      expect(Buffer.from(record.token, "base64url")).toHaveLength(32);
      expect(statSync(directory).mode % 0o1000).toBe(0o700);
      expect(statSync(capability.file).mode % 0o1000).toBe(0o600);

      writeFileSync(
        capability.file,
        JSON.stringify({ ...record, token: "replacement-token" }),
        { mode: 0o600 }
      );
      capability.cleanup();
      expect(existsSync(capability.file)).toBe(true);

      const replacement = createCodexHookCapability({
        directory,
        endpoint: record.endpoint,
        pid: 456,
        processStartMarker: "replacement-start",
      });
      expect(replacement.record.token).not.toBe(record.token);
      replacement.cleanup();
      expect(existsSync(replacement.file)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
