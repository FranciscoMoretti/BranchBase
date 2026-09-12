import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import pathModule from "node:path";

/** The transaction is held for the daemon lifetime and released by the OS on exit. */
export const acquireWriterLease = (directory: string): (() => void) => {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const database = new Database(
    pathModule.join(directory, "daemon-writer.sqlite"),
    { create: true, strict: true }
  );
  try {
    database.run("BEGIN IMMEDIATE");
  } catch (error) {
    database.close(true);
    throw new Error("Another BranchBase daemon owns this control directory", {
      cause: error,
    });
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
