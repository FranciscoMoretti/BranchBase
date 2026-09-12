import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import pathModule from "node:path";

export const readJsonFile = (file: string): unknown =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : undefined;

export const writeJsonFile = (file: string, value: unknown): void => {
  mkdirSync(pathModule.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
};
