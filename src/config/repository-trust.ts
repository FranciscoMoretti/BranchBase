import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BranchBaseCommand } from "./branchbase-command";
import type { BranchBaseConfig } from "./branchbase-config";

function defaultControlDirectory(): string {
  return process.env.BRANCHBASE_CONTROL_DIR ?? join(homedir(), ".branchbase");
}

function trustFile(controlDirectory = defaultControlDirectory()): string {
  return join(controlDirectory, "trusted-repositories.json");
}

const TrustStoreSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.string(), z.array(z.string())])
);

const TRUST_LOCK_TIMEOUT_MS = 10_000;
const TRUST_LOCK_RETRY_MS = 10;

function waitForLock(): void {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    TRUST_LOCK_RETRY_MS
  );
}

function withTrustStoreLock<T>(
  controlDirectory: string,
  action: (file: string) => T
): T {
  const file = trustFile(controlDirectory);
  mkdirSync(controlDirectory, { recursive: true });
  const database = new Database(`${file}.lock`, {
    create: true,
    strict: true,
  });
  const started = Date.now();

  try {
    while (true) {
      try {
        database.run("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "SQLITE_BUSY") {
          throw error;
        }
        if (Date.now() - started >= TRUST_LOCK_TIMEOUT_MS) {
          throw new Error(
            `Timed out waiting for repository trust lock: ${file}`
          );
        }
        waitForLock();
      }
    }
    try {
      return action(file);
    } finally {
      database.run("ROLLBACK");
    }
  } finally {
    database.close(true);
  }
}

function writeTrustStore(
  file: string,
  store: Record<string, boolean | string | string[]>
): void {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function trustStore(
  controlDirectory?: string,
  failOnInvalid = false
): Record<string, boolean | string | string[]> {
  const file = trustFile(controlDirectory);
  if (!existsSync(file)) {
    return {};
  }
  try {
    return TrustStoreSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if (failOnInvalid) {
      throw new Error(
        "Repository trust store is invalid; refusing to overwrite it.",
        { cause: error }
      );
    }
    return {};
  }
}

export function repositoryRequiresTrust(_config: BranchBaseConfig): boolean {
  return true;
}

function fingerprintCommand(command: BranchBaseCommand) {
  return { argv: command.argv, ...(command.cwd ? { cwd: command.cwd } : {}) };
}

export function repositoryCommandFingerprint(config: BranchBaseConfig): string {
  const commands = {
    appGroups: Object.fromEntries(
      Object.entries(config.appGroups).map(([name, group]) => [
        name,
        {
          apps: group.apps,
          env: group.env ?? {},
          instances: group.instances,
          start: fingerprintCommand(group.start),
          stop:
            group.stop === "process"
              ? "process"
              : fingerprintCommand(group.stop),
        },
      ])
    ),
    setup: fingerprintCommand(config.setup),
  };
  return createHash("sha256")
    .update(JSON.stringify(commands))
    .digest("base64url");
}

export function repositoryIsTrusted(
  repoPath: string,
  config: BranchBaseConfig,
  controlDirectory?: string
): boolean {
  if (!repositoryRequiresTrust(config)) {
    return true;
  }
  const trusted = trustStore(controlDirectory)[repoPath];
  const fingerprint = repositoryCommandFingerprint(config);
  return repositoryFingerprintIsTrusted(
    repoPath,
    fingerprint,
    controlDirectory,
    trusted
  );
}

export function repositoryFingerprintIsTrusted(
  repoPath: string,
  fingerprint: string,
  controlDirectory?: string,
  knownValue?: boolean | string | string[]
): boolean {
  const trusted = knownValue ?? trustStore(controlDirectory)[repoPath];
  return Array.isArray(trusted)
    ? trusted.includes(fingerprint)
    : trusted === fingerprint;
}

export function trustRepository(
  repoPath: string,
  config: BranchBaseConfig,
  controlDirectory?: string
): void {
  const directory = controlDirectory ?? defaultControlDirectory();
  const fingerprint = repositoryCommandFingerprint(config);
  withTrustStoreLock(directory, (file) => {
    const store = trustStore(directory, true);
    const existing = store[repoPath];
    let fingerprints: string[] = [];
    if (Array.isArray(existing)) {
      fingerprints = existing;
    } else if (typeof existing === "string") {
      fingerprints = [existing];
    }
    writeTrustStore(file, {
      ...store,
      [repoPath]: [...new Set([...fingerprints, fingerprint])],
    });
  });
}

export function revokeRepositoryTrust(
  repoPath: string,
  controlDirectory?: string
): void {
  const directory = controlDirectory ?? defaultControlDirectory();
  withTrustStoreLock(directory, (file) => {
    const store = trustStore(directory, true);
    delete store[repoPath];
    writeTrustStore(file, store);
  });
}
