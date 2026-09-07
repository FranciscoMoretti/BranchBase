import { existsSync, readFileSync, realpathSync } from "node:fs";
import pathModule from "node:path";

import { parseCurrentBranchBaseLocalState } from "../runtime/local-state";
import type { BranchBaseLocalState } from "../runtime/local-state";
import {
  inspectListeningPorts,
  listeningPortPids,
  pidOwnedByWorktree,
} from "../runtime/ports";
import {
  appGroupInstanceProcessId,
  ProcessSupervisor,
} from "../runtime/process-supervisor";

type RecordedInstance =
  BranchBaseLocalState["repositories"][string]["instances"][string];

export interface VerifiedWorktreeRun {
  groupId: string;
  pid: number;
  port: number;
  worktreePath: string;
}

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

function liveRunEvidence(
  instance: RecordedInstance,
  worktreePath: string,
  processes: ProcessSupervisor,
  ports: ReturnType<typeof inspectListeningPorts>
): Pick<VerifiedWorktreeRun, "pid" | "port"> | null {
  if (
    !instance.run ||
    canonicalPath(instance.run.worktreePath) !== worktreePath
  ) {
    return null;
  }
  const listeners = Object.values(instance.run.apps).flatMap((endpoint) =>
    listeningPortPids(ports, endpoint.port).map((pid) => ({
      claimed: endpoint.listenerClaimed === true,
      pid,
      port: endpoint.port,
    }))
  );
  const managedPid = processes.managedPid(
    appGroupInstanceProcessId(instance.id),
    worktreePath
  );
  const listener =
    listeners.find(({ pid }) => pidOwnedByWorktree(pid, worktreePath)) ??
    listeners.find(({ claimed }) => claimed);
  const pid = managedPid ?? listener?.pid;
  const port = listener?.port ?? Object.values(instance.run.apps)[0]?.port;
  return pid && port ? { pid, port } : null;
}

export function findVerifiedWorktreeRun(
  controlDirectory: string,
  worktreePathValue: string
): VerifiedWorktreeRun | null {
  const statePath = pathModule.join(controlDirectory, "state.json");
  if (!existsSync(statePath)) {
    return null;
  }
  const state = parseCurrentBranchBaseLocalState(
    JSON.parse(readFileSync(statePath, "utf-8"))
  );
  const worktreePath = realpathSync(worktreePathValue);
  const processes = new ProcessSupervisor(controlDirectory);
  const ports = inspectListeningPorts();

  for (const repository of Object.values(state.repositories)) {
    for (const instance of Object.values(repository.instances)) {
      const evidence = liveRunEvidence(
        instance,
        worktreePath,
        processes,
        ports
      );
      if (evidence) {
        return {
          groupId: instance.groupId,
          ...evidence,
          worktreePath,
        };
      }
    }
  }
  return null;
}
