import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
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

function trustStore(
  controlDirectory?: string
): Record<string, boolean | string | string[]> {
  const file = trustFile(controlDirectory);
  if (!existsSync(file)) {
    return {};
  }
  try {
    return TrustStoreSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
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
  const file = trustFile(directory);
  const store = trustStore(directory);
  const existing = store[repoPath];
  let fingerprints: string[] = [];
  if (Array.isArray(existing)) {
    fingerprints = existing;
  } else if (typeof existing === "string") {
    fingerprints = [existing];
  }
  const fingerprint = repositoryCommandFingerprint(config);
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        ...store,
        [repoPath]: [...new Set([...fingerprints, fingerprint])],
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  renameSync(temporary, file);
}

export function revokeRepositoryTrust(
  repoPath: string,
  controlDirectory?: string
): void {
  const directory = controlDirectory ?? defaultControlDirectory();
  const store = trustStore(directory);
  delete store[repoPath];
  mkdirSync(directory, { recursive: true });
  const file = trustFile(directory);
  const temporary = `${file}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
}
