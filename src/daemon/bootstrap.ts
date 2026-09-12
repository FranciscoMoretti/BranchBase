import { homedir } from "node:os";
import pathModule from "node:path";

import { createBranchBaseServer } from "../adapters/http/branchbase-server";
import type {
  BranchBaseServer,
  BranchBaseServerOptions,
} from "../adapters/http/branchbase-server";
import { acquireWriterLease } from "../adapters/persistence/writer-lease";
import { WorkspaceController } from "../application/workspace-controller";

/** Production composition root. All interaction adapters share this writer. */
export const createDaemon = async (
  options: Omit<BranchBaseServerOptions, "controller">
): Promise<BranchBaseServer> => {
  const release = acquireWriterLease(pathModule.join(homedir(), ".branchbase"));
  let controller: WorkspaceController | null = null;
  try {
    controller = new WorkspaceController();
    const server = await createBranchBaseServer({ ...options, controller });
    return {
      close: async () => {
        try {
          await server.close();
        } finally {
          release();
        }
      },
      listen: async () => {
        try {
          return await server.listen();
        } catch (error) {
          try {
            await server.close();
          } finally {
            release();
          }
          throw error;
        }
      },
    };
  } catch (error) {
    try {
      await controller?.close();
    } finally {
      release();
    }
    throw error;
  }
};
