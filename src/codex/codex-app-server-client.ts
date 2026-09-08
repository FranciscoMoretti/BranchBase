import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { z } from "zod";

import packageMetadata from "../../package.json";
import { CodexIntegrationUnavailableError } from "./codex-integration";

export interface CodexCommand {
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  executable: string;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const RpcResponseSchema = z.object({
  error: z.unknown().optional(),
  id: z.number().int().optional(),
  result: z.unknown().optional(),
});
type RpcResponse = z.infer<typeof RpcResponseSchema>;

export class CodexAppServerClient {
  private child: ChildProcess | null = null;
  private readonly command: CodexCommand;
  private initialized: Promise<void> | null = null;
  private readonly maxLineBytes: number;
  private nextId = 1;
  private outputBuffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestTimeoutMs: number;

  constructor(
    command: CodexCommand,
    requestTimeoutMs: number,
    maxLineBytes: number
  ) {
    this.command = command;
    this.maxLineBytes = maxLineBytes;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async close(): Promise<void> {
    const { child } = this;
    this.child = null;
    this.initialized = null;
    this.outputBuffer = Buffer.alloc(0);
    this.rejectPending("Codex app-server closed");
    if (!child) {
      return;
    }
    child.stdin?.end();
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve();
      }, 250);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async listThreads(
    cwd: readonly string[],
    cursor: string | null
  ): Promise<unknown> {
    await this.initialize();
    return this.request("thread/list", {
      archived: false,
      cursor,
      cwd,
      limit: 100,
      sortDirection: "desc",
      sortKey: "updated_at",
      useStateDbOnly: true,
    });
  }

  private initialize(): Promise<void> {
    if (!this.initialized) {
      const initialization = this.startAndInitialize().catch(
        async (error: unknown) => {
          if (this.initialized === initialization) {
            this.initialized = null;
          }
          await this.close();
          throw error;
        }
      );
      this.initialized = initialization;
    }
    return this.initialized;
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexIntegrationUnavailableError(message));
    }
    this.pending.clear();
  }

  private fail(message: string): void {
    const { child } = this;
    this.child = null;
    this.initialized = null;
    this.outputBuffer = Buffer.alloc(0);
    this.rejectPending(message);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const { child } = this;
    if (!child?.stdin?.writable) {
      return Promise.reject(
        new CodexIntegrationUnavailableError("Codex app-server exited")
      );
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexIntegrationUnavailableError("Codex request timed out"));
      }, this.requestTimeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private async startAndInitialize(): Promise<void> {
    const child = spawn(
      this.command.executable,
      [...(this.command.args ?? []), "app-server", "--stdio"],
      {
        env: { ...process.env, ...this.command.env },
        stdio: ["pipe", "pipe", "ignore"],
      }
    );
    this.child = child;
    child.once("error", () => {
      this.fail("Codex executable is unavailable");
    });
    child.once("exit", () => {
      this.outputBuffer = Buffer.alloc(0);
      this.rejectPending("Codex app-server exited");
      this.child = null;
      this.initialized = null;
    });
    child.stdin?.on("error", () => {
      // The process lifecycle reports stdin failures.
    });
    if (!child.stdout) {
      throw new CodexIntegrationUnavailableError(
        "Codex app-server output is unavailable"
      );
    }
    child.stdout.on("data", (chunk: Buffer | string) =>
      this.receiveChunk(chunk)
    );
    await this.request("initialize", {
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
      clientInfo: {
        name: "branchbase",
        title: "BranchBase",
        version: packageMetadata.version,
      },
    });
    child.stdin?.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }

  private receiveChunk(chunk: Buffer | string): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.outputBuffer = Buffer.concat([this.outputBuffer, value]);
    let newline = this.outputBuffer.indexOf(10);
    while (newline !== -1) {
      const line = this.outputBuffer.subarray(0, newline);
      this.outputBuffer = this.outputBuffer.subarray(newline + 1);
      if (line.byteLength > this.maxLineBytes) {
        this.fail("Codex response exceeded the safety limit");
        return;
      }
      const content =
        line.at(-1) === 13 ? line.subarray(0, line.byteLength - 1) : line;
      this.receive(content.toString("utf-8"));
      newline = this.outputBuffer.indexOf(10);
    }
    if (this.outputBuffer.byteLength > this.maxLineBytes) {
      this.fail("Codex response exceeded the safety limit");
    }
  }

  private receive(line: string): void {
    let message: RpcResponse;
    try {
      message = RpcResponseSchema.parse(JSON.parse(line));
    } catch {
      this.fail("Codex returned an incompatible response");
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(
        new CodexIntegrationUnavailableError(
          "Codex does not support safe task discovery"
        )
      );
      return;
    }
    pending.resolve(message.result);
  }
}

const commandIsAvailable = (
  command: CodexCommand,
  timeoutMs: number
): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn(
      command.executable,
      [...(command.args ?? []), "--version"],
      {
        env: { ...process.env, ...command.env },
        stdio: "ignore",
      }
    );
    let settled = false;
    const handlers = {
      finish(available: boolean) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(handlers.timer);
        resolve(available);
      },
      timer: setTimeout(() => {
        child.kill("SIGTERM");
        handlers.finish(false);
      }, timeoutMs),
    };
    child.once("error", () => handlers.finish(false));
    child.once("exit", (code) => handlers.finish(code === 0));
  });

export const resolveCodexCommand = async (
  commands: readonly CodexCommand[],
  versionTimeoutMs: number
): Promise<CodexCommand> => {
  for (const command of commands) {
    if (await commandIsAvailable(command, versionTimeoutMs)) {
      return command;
    }
  }
  throw new CodexIntegrationUnavailableError("Codex executable is unavailable");
};
