import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import pathModule from "node:path";

import { z } from "zod";

export type TrustStoreValue = boolean | string | string[];
export type TrustStoreData = Record<string, TrustStoreValue>;

const TrustStoreSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.string(), z.array(z.string())])
);

const trustFile = (controlDirectory: string): string =>
  pathModule.join(controlDirectory, "trusted-repositories.json");

/** Filesystem persistence for trust records. Invalid data always fails closed. */
export class TrustStore {
  private readonly controlDirectory: string;

  constructor(controlDirectory: string) {
    this.controlDirectory = controlDirectory;
  }

  read(failOnInvalid = false): TrustStoreData {
    const file = trustFile(this.controlDirectory);
    if (!existsSync(file)) {
      return {};
    }
    try {
      return TrustStoreSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
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

  update(action: (store: TrustStoreData) => TrustStoreData): void {
    const file = trustFile(this.controlDirectory);
    mkdirSync(this.controlDirectory, { recursive: true });
    const lockDirectory = `${file}.write-lock`;
    try {
      mkdirSync(lockDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Repository trust store is busy; retry the approval change. If a writer was interrupted, stop BranchBase processes before removing ${lockDirectory}.`,
          { cause: error }
        );
      }
      throw error;
    }
    try {
      const next = action(this.read(true));
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    } finally {
      rmdirSync(lockDirectory);
    }
  }
}
