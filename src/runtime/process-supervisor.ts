import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

import { z } from "zod";

import { processStartMarker } from "../host/process-inspection";
import { pathInside, pidOwnedByWorktree } from "./ports";

const LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAK = /\r?\n$/;
const GRACEFUL_STOP_ATTEMPTS = 20;
const FORCE_STOP_ATTEMPTS = 10;
const STOP_POLL_MS = 100;

const ProcessRecordSchema = z.strictObject({
  argv: z.array(z.string()).min(1),
  cwd: z.string().min(1),
  label: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  pid: z.number().int().positive(),
  startMarker: z.string().min(1),
  startedAt: z.string().min(1),
});
const ProcessFailureSchema = z.strictObject({
  failedAt: z.string().min(1),
  message: z.string().min(1),
});
type ProcessRecord = z.infer<typeof ProcessRecordSchema>;
type ProcessFailure = z.infer<typeof ProcessFailureSchema>;

interface ProcessSignalTarget {
  id: number;
  kind: "group" | "process";
}

export interface ManagedProcessSummary {
  argv: string[];
  cwd: string;
  label: string;
  ownerId: string;
  pid: number;
  startedAt: string;
}

export interface StartManagedProcessInput {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  label?: string;
  logId?: string;
  ownerId?: string;
  ownerRoot: string;
  processId: string;
  trackExitFailure?: boolean;
}

export const setupProcessId = (worktreeId: string): string =>
  `${worktreeId}--setup`;

export const appGroupProcessId = (
  worktreeId: string,
  appGroupId: string
): string =>
  `${worktreeId}--app-group--${Buffer.from(appGroupId).toString("base64url")}`;

export const appGroupInstanceProcessId = (instanceId: string): string =>
  `${instanceId}--app-group-instance`;

const safeId = (processId: string): string =>
  processId.replaceAll(/[^A-Za-z0-9_-]/g, "_");

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

export class ProcessSupervisor {
  readonly controlDirectory: string;
  private readonly plannedStops = new Set<number>();
  private readonly processes = new Map<
    string,
    { child: ChildProcess; record: ProcessRecord }
  >();

  constructor(
    controlDirectory = process.env.BRANCHBASE_CONTROL_DIR ??
      pathModule.join(homedir(), ".branchbase")
  ) {
    this.controlDirectory = controlDirectory;
    mkdirSync(this.controlDirectory, { recursive: true });
  }

  logPath(processId: string): string {
    return pathModule.join(this.controlDirectory, `${safeId(processId)}.log`);
  }

  managedPid(processId: string, expectedWorktreePath: string): number | null {
    const tracked = this.processes.get(processId);
    if (
      tracked?.child.pid &&
      pathInside(tracked.record.cwd, expectedWorktreePath) &&
      this.processTargetIsLive({ id: tracked.child.pid, kind: "process" })
    ) {
      return tracked.child.pid;
    }
    const record = this.persistedRecord(processId);
    if (
      !(
        record &&
        pathInside(record.cwd, expectedWorktreePath) &&
        this.processTargetIsLive({ id: record.pid, kind: "process" }) &&
        pidOwnedByWorktree(record.pid, expectedWorktreePath)
      ) ||
      processStartMarker(record.pid) !== record.startMarker
    ) {
      return null;
    }
    return record.pid;
  }

  managedPidByIdentity(processId: string, ownerId: string): number | null {
    const tracked = this.processes.get(processId);
    if (
      tracked?.child.pid &&
      tracked.record.ownerId === ownerId &&
      this.processTargetIsLive({ id: tracked.child.pid, kind: "process" }) &&
      processStartMarker(tracked.child.pid) === tracked.record.startMarker
    ) {
      return tracked.child.pid;
    }
    const record = this.persistedRecord(processId);
    const ownerMatches = record
      ? record.ownerId === ownerId ||
        (record.ownerId === undefined && processId === setupProcessId(ownerId))
      : false;
    if (!(record && ownerMatches)) {
      return null;
    }
    if (
      !this.processTargetIsLive({ id: record.pid, kind: "process" }) ||
      processStartMarker(record.pid) !== record.startMarker
    ) {
      return null;
    }
    return record.pid;
  }

  startManagedProcess(input: StartManagedProcessInput): number {
    if (!pathInside(input.cwd, input.ownerRoot)) {
      const message = "Command working directory must stay inside its worktree";
      if (input.trackExitFailure) {
        this.recordFailure(input.processId, message);
      }
      throw new Error(message);
    }
    const existing = this.managedPid(input.processId, input.cwd);
    if (existing) {
      throw new Error(`Apps are already managed by pid ${existing}`);
    }
    const [command, ...args] = input.argv;
    if (!command) {
      throw new Error("Start command requires at least one argv entry");
    }
    if (input.trackExitFailure) {
      rmSync(this.failurePath(input.processId), { force: true });
    }
    const log = openSync(this.logPath(input.logId ?? input.processId), "a");
    const child = (() => {
      try {
        return spawn(command, args, {
          cwd: input.cwd,
          detached: true,
          env: { ...process.env, ...input.env },
          stdio: ["ignore", log, log],
        });
      } finally {
        closeSync(log);
      }
    })();
    child.once("error", (error) => {
      this.appendManagedLogIfAvailable(
        input.logId ?? input.processId,
        `[branchbase] Failed to start ${command}: ${error.message}`
      );
      if (input.trackExitFailure) {
        this.recordFailure(input.processId, error.message);
      }
      if (this.processes.get(input.processId)?.record.pid === child.pid) {
        this.processes.delete(input.processId);
      }
      rmSync(this.pidPath(input.processId), { force: true });
    });
    if (!child.pid) {
      throw new Error(`Failed to start ${command}`);
    }
    const recordStartedAt = new Date().toISOString();
    const recordStartMarker = processStartMarker(child.pid);
    const record: ProcessRecord = {
      argv: input.argv,
      cwd: input.cwd,
      label: input.label,
      ownerId: input.ownerId ?? input.logId ?? input.processId,
      pid: child.pid,
      startMarker: recordStartMarker,
      startedAt: recordStartedAt,
    };
    this.processes.set(input.processId, { child, record });
    writeFileSync(this.pidPath(input.processId), `${JSON.stringify(record)}\n`);
    child.once("exit", (code, signal) => {
      if (input.trackExitFailure) {
        if (code === 0) {
          rmSync(this.failurePath(input.processId), { force: true });
        } else {
          this.recordFailure(
            input.processId,
            signal
              ? `Exited after ${signal}`
              : `Exited with status ${code ?? "unknown"}`
          );
        }
      }
      if (this.processes.get(input.processId)?.record.pid === child.pid) {
        this.processes.delete(input.processId);
        rmSync(this.pidPath(input.processId), { force: true });
      }
      if (child.pid && !this.plannedStops.has(child.pid)) {
        const groupTarget: ProcessSignalTarget = {
          id: child.pid,
          kind: "group",
        };
        if (this.processTargetIsLive(groupTarget)) {
          const logId = input.logId ?? input.processId;
          this.appendManagedLogIfAvailable(
            logId,
            "[branchbase] Managed process exited; stopping remaining descendants"
          );
          this.stopProcessTarget(groupTarget, logId).catch((error) => {
            this.appendManagedLogIfAvailable(
              logId,
              `[branchbase] Failed to stop remaining descendants: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      }
    });
    child.unref();
    return child.pid;
  }

  async runFiniteCommand(input: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    label: string;
    logId: string;
  }): Promise<void> {
    const [command, ...args] = input.argv;
    if (!command) {
      throw new Error(`${input.label} requires at least one argv entry`);
    }
    this.appendManagedLog(
      input.logId,
      `[branchbase] ${input.label}: ${input.argv.join(" ")}`
    );
    const log = openSync(this.logPath(input.logId), "a");
    const child = (() => {
      try {
        return spawn(command, args, {
          cwd: input.cwd,
          env: { ...process.env, ...input.env },
          stdio: ["ignore", log, log],
        });
      } finally {
        closeSync(log);
      }
    })();
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            signal
              ? `${input.label} exited after ${signal}`
              : `${input.label} exited with status ${code ?? "unknown"}`
          )
        );
      });
    });
  }

  listManagedProcesses(): ManagedProcessSummary[] {
    return readdirSync(this.controlDirectory)
      .filter((name) => name.endsWith(".pid"))
      .flatMap((name) => {
        try {
          const record = ProcessRecordSchema.parse(
            JSON.parse(
              readFileSync(
                pathModule.join(this.controlDirectory, name),
                "utf-8"
              )
            )
          );
          if (
            !this.processTargetIsLive({ id: record.pid, kind: "process" }) ||
            processStartMarker(record.pid) !== record.startMarker ||
            !pidOwnedByWorktree(record.pid, record.cwd)
          ) {
            return [];
          }
          return [
            {
              argv: record.argv,
              cwd: record.cwd,
              label: record.label ?? record.argv[0] ?? "Process",
              ownerId: record.ownerId ?? name.slice(0, -4),
              pid: record.pid,
              startedAt: record.startedAt,
            },
          ];
        } catch {
          return [];
        }
      });
  }

  managedFailure(processId: string): ProcessFailure | null {
    try {
      return ProcessFailureSchema.parse(
        JSON.parse(readFileSync(this.failurePath(processId), "utf-8"))
      );
    } catch {
      return null;
    }
  }

  async stopManagedProcess(
    processId: string,
    worktreePath: string
  ): Promise<number | null> {
    const pid = this.managedPid(processId, worktreePath);
    if (!pid) {
      return null;
    }
    const groupTarget: ProcessSignalTarget = { id: pid, kind: "group" };
    const target = this.processTargetIsLive(groupTarget)
      ? groupTarget
      : ({ id: pid, kind: "process" } satisfies ProcessSignalTarget);
    this.plannedStops.add(pid);
    try {
      await this.stopProcessTarget(target, processId);
    } finally {
      this.plannedStops.delete(pid);
    }
    if (this.processes.get(processId)?.record.pid === pid) {
      this.processes.delete(processId);
    }
    if (this.persistedRecord(processId)?.pid === pid) {
      rmSync(this.pidPath(processId), { force: true });
    }
    return pid;
  }

  async stopOwnedProcess(pid: number, logId: string): Promise<boolean> {
    const target: ProcessSignalTarget = { id: pid, kind: "process" };
    if (!this.processTargetIsLive(target)) {
      return false;
    }
    await this.stopProcessTarget(target, logId);
    return true;
  }

  appendManagedLog(processId: string, message: string): void {
    const fd = openSync(this.logPath(processId), "a");
    writeFileSync(fd, `${message}\n`);
    closeSync(fd);
  }

  readManagedLog(processId: string, maxLines = 2000): string[] {
    const file = this.logPath(processId);
    if (!existsSync(file)) {
      return [];
    }
    const content = readFileSync(file, "utf-8").replace(
      TRAILING_LINE_BREAK,
      ""
    );
    return content === "" ? [] : content.split(LINE_BREAK).slice(-maxLines);
  }

  clearManagedLog(processId: string): void {
    writeFileSync(this.logPath(processId), "");
  }

  private pidPath(processId: string): string {
    return pathModule.join(this.controlDirectory, `${safeId(processId)}.pid`);
  }

  private failurePath(processId: string): string {
    return pathModule.join(
      this.controlDirectory,
      `${safeId(processId)}.failure.json`
    );
  }

  private appendManagedLogIfAvailable(
    processId: string,
    message: string
  ): void {
    try {
      this.appendManagedLog(processId, message);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  private recordFailure(processId: string, message: string): void {
    const failure: ProcessFailure = {
      failedAt: new Date().toISOString(),
      message,
    };
    try {
      writeFileSync(
        this.failurePath(processId),
        `${JSON.stringify(failure)}\n`
      );
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  private persistedRecord(processId: string): ProcessRecord | null {
    const file = this.pidPath(processId);
    if (!existsSync(file)) {
      return null;
    }
    try {
      return ProcessRecordSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
    } catch {
      return null;
    }
  }

  private processTargetIsLive(target: ProcessSignalTarget): boolean {
    try {
      process.kill(target.kind === "group" ? -target.id : target.id, 0);
      return true;
    } catch {
      return false;
    }
  }

  private signalProcessTarget(
    target: ProcessSignalTarget,
    signal: NodeJS.Signals
  ): void {
    process.kill(target.kind === "group" ? -target.id : target.id, signal);
  }

  private async stopProcessTarget(
    target: ProcessSignalTarget,
    logId?: string
  ): Promise<void> {
    try {
      this.signalProcessTarget(target, "SIGTERM");
    } catch (error) {
      if (!this.processTargetIsLive(target)) {
        return;
      }
      throw error;
    }
    for (let attempt = 0; attempt < GRACEFUL_STOP_ATTEMPTS; attempt += 1) {
      if (!this.processTargetIsLive(target)) {
        return;
      }
      await delay(STOP_POLL_MS);
    }
    if (logId) {
      this.appendManagedLog(
        logId,
        "[branchbase] Force-stopping processes that ignored SIGTERM"
      );
    }
    try {
      this.signalProcessTarget(target, "SIGKILL");
    } catch (error) {
      if (!this.processTargetIsLive(target)) {
        return;
      }
      throw error;
    }
    for (let attempt = 0; attempt < FORCE_STOP_ATTEMPTS; attempt += 1) {
      if (!this.processTargetIsLive(target)) {
        return;
      }
      await delay(STOP_POLL_MS);
    }
    throw new Error(`Managed ${target.kind} ${target.id} did not stop`);
  }
}
