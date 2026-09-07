import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import pathModule from "node:path";

export function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (!(stat.isDirectory() && !stat.isSymbolicLink())) {
    throw new Error("Codex control path must be a private directory");
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error("Codex control path must be owned by the current user");
  }
  chmodSync(directory, 0o700);
}

export function readPrivateJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function writePrivateJsonFile(file: string, value: unknown): void {
  const directory = pathModule.dirname(file);
  ensurePrivateDirectory(directory);
  const temporary = pathModule.join(
    directory,
    `.${pathModule.basename(file)}.${process.pid}.${randomUUID()}.tmp`
  );
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
