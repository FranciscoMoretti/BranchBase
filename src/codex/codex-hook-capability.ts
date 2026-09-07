import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

import { z } from "zod";

import { readPrivateJsonFile, writePrivateJsonFile } from "./private-json-file";

export const CodexHookCapabilityRecordSchema = z
  .object({
    endpoint: z.url(),
    generatedAt: z.iso.datetime({ offset: true }),
    pid: z.number().int().positive(),
    processStartMarker: z.string().min(1).max(256),
    token: z.string().min(32).max(128),
    version: z.literal(1),
  })
  .strict();

export type CodexHookCapabilityRecord = z.infer<
  typeof CodexHookCapabilityRecordSchema
>;

export interface CodexHookCapability {
  cleanup: () => void;
  file: string;
  record: CodexHookCapabilityRecord;
}

export function createCodexHookCapability(options: {
  directory?: string;
  endpoint: string;
  now?: Date;
  pid: number;
  processStartMarker: string;
}): CodexHookCapability {
  const directory =
    options.directory ?? pathModule.join(homedir(), ".branchbase", "codex");
  const file = pathModule.join(directory, "capability.json");
  const record = CodexHookCapabilityRecordSchema.parse({
    endpoint: options.endpoint,
    generatedAt: (options.now ?? new Date()).toISOString(),
    pid: options.pid,
    processStartMarker: options.processStartMarker,
    token: randomBytes(32).toString("base64url"),
    version: 1,
  });
  writePrivateJsonFile(file, record);

  return {
    cleanup() {
      if (!existsSync(file)) {
        return;
      }
      try {
        const current = CodexHookCapabilityRecordSchema.parse(
          readPrivateJsonFile(file)
        );
        if (
          current.pid === record.pid &&
          current.processStartMarker === record.processStartMarker &&
          current.token === record.token
        ) {
          rmSync(file, { force: true });
        }
      } catch {
        // A malformed or replaced file does not belong to this capability.
      }
    },
    file,
    record,
  };
}
