import { Database } from "bun:sqlite";

export class ExclusiveFileLockBusyError extends Error {
  constructor() {
    super("BranchBase development session ownership is busy");
    this.name = "ExclusiveFileLockBusyError";
  }
}

export const acquireExclusiveFileLock = (file: string): (() => void) => {
  const database = new Database(file, { create: true, strict: true });
  try {
    database.run("BEGIN IMMEDIATE");
  } catch (error) {
    database.close(true);
    if ((error as { code?: unknown }).code === "SQLITE_BUSY") {
      throw new ExclusiveFileLockBusyError();
    }
    throw new Error(
      "Could not acquire BranchBase development session ownership",
      {
        cause: error,
      }
    );
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    try {
      database.run("ROLLBACK");
    } finally {
      database.close(true);
    }
  };
};
