import pathModule from "node:path";

import { z } from "zod";

import { codexExecutableCandidates } from "../host/codex-executable";
import {
  CodexAppServerClient,
  resolveCodexCommand,
} from "./codex-app-server-client";
import type { CodexCommand } from "./codex-app-server-client";
import { CodexIntegrationUnavailableError } from "./codex-integration";
import type {
  CodexIntegrationAdapter,
  CodexIntegrationAdapterSnapshot,
  CodexIntegrationLoadOptions,
  CodexWorktreeReference,
} from "./codex-integration";

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PATH_LENGTH = 4096;

const ThreadSummarySchema = z.object({
  createdAt: z.number().int().nonnegative(),
  cwd: z.string().min(1).max(MAX_PATH_LENGTH),
  id: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  name: z.string().min(1).max(1024).nullable().optional(),
  updatedAt: z.number().int().nonnegative(),
});

const ThreadListResultSchema = z.object({
  data: z.array(ThreadSummarySchema),
  nextCursor: z.string().min(1).max(MAX_PATH_LENGTH).nullable().optional(),
});

interface CodexTaskDiscoveryOptions {
  command?: CodexCommand;
  commands?: readonly CodexCommand[];
  maxLineBytes?: number;
  negativeTtlMs?: number;
  now?: () => Date;
  refreshTimeoutMs?: number;
  requestTimeoutMs?: number;
  successfulTtlMs?: number;
  versionTimeoutMs?: number;
}

const timestamp = (seconds: number): string => {
  const value = new Date(seconds * 1000);
  if (Number.isNaN(value.valueOf())) {
    throw new CodexIntegrationUnavailableError(
      "Codex returned incompatible task metadata"
    );
  }
  return value.toISOString();
};

export class CodexTaskDiscoveryAdapter implements CodexIntegrationAdapter {
  private cache:
    | {
        expiresAt: number;
        key: string;
        snapshot: CodexIntegrationAdapterSnapshot;
      }
    | undefined;
  private clientPromise: Promise<CodexAppServerClient> | undefined;
  private readonly commands: readonly CodexCommand[];
  private failure:
    | {
        error: CodexIntegrationUnavailableError;
        expiresAt: number;
        key: string;
      }
    | undefined;
  private inFlight:
    | {
        key: string;
        promise: Promise<CodexIntegrationAdapterSnapshot>;
      }
    | undefined;
  private readonly maxLineBytes: number;
  private readonly negativeTtlMs: number;
  private readonly now: () => Date;
  private readonly refreshTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly successfulTtlMs: number;
  private readonly versionTimeoutMs: number;

  constructor(options: CodexTaskDiscoveryOptions = {}) {
    this.commands =
      options.commands ??
      (options.command
        ? [options.command]
        : codexExecutableCandidates().map((executable) => ({ executable })));
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.negativeTtlMs = options.negativeTtlMs ?? 5000;
    this.now = options.now ?? (() => new Date());
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.successfulTtlMs = options.successfulTtlMs ?? 30_000;
    this.versionTimeoutMs = options.versionTimeoutMs ?? 1000;
  }

  async close(): Promise<void> {
    const clientPromise = this.clientPromise;
    this.clientPromise = undefined;
    if (!clientPromise) {
      return;
    }
    try {
      await (await clientPromise).close();
    } catch {
      // A failed executable resolution has no child process to close.
    }
  }

  async loadAssociatedTasks(
    worktrees: readonly CodexWorktreeReference[],
    options: CodexIntegrationLoadOptions = {}
  ): Promise<CodexIntegrationAdapterSnapshot> {
    const paths = [...new Set(worktrees.map(({ path }) => path))].toSorted();
    if (paths.some((path) => !pathModule.isAbsolute(path))) {
      throw new CodexIntegrationUnavailableError(
        "Codex task discovery requires canonical worktree paths"
      );
    }
    if (paths.length === 0) {
      return { tasks: [], updatedAt: this.now().toISOString() };
    }
    const key = JSON.stringify(paths);
    const now = this.now().valueOf();
    if (
      !options.force &&
      this.cache?.key === key &&
      this.cache.expiresAt > now
    ) {
      return this.cache.snapshot;
    }
    if (
      !options.force &&
      this.failure?.key === key &&
      this.failure.expiresAt > now
    ) {
      throw this.failure.error;
    }
    if (this.inFlight?.key === key) {
      return this.inFlight.promise;
    }
    const promise = (async () => {
      try {
        const snapshot = await this.refreshWithinDeadline(paths);
        this.failure = undefined;
        this.cache = {
          expiresAt: this.now().valueOf() + this.successfulTtlMs,
          key,
          snapshot,
        };
        return snapshot;
      } catch (error: unknown) {
        const unavailable =
          error instanceof CodexIntegrationUnavailableError
            ? error
            : new CodexIntegrationUnavailableError();
        this.failure = {
          error: unavailable,
          expiresAt: this.now().valueOf() + this.negativeTtlMs,
          key,
        };
        throw unavailable;
      }
    })();
    this.inFlight = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.inFlight?.promise === promise) {
        this.inFlight = undefined;
      }
    }
  }

  private async refreshWithinDeadline(
    paths: readonly string[]
  ): Promise<CodexIntegrationAdapterSnapshot> {
    const timeoutResult = Promise.withResolvers<never>();
    const timer = setTimeout(() => {
      timeoutResult.reject(
        new CodexIntegrationUnavailableError("Codex refresh timed out")
      );
      void (async () => {
        try {
          await this.close();
        } catch {
          // Closing after a refresh timeout is best-effort.
        }
      })();
    }, this.refreshTimeoutMs);
    try {
      return await Promise.race([this.refresh(paths), timeoutResult.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(
    paths: readonly string[]
  ): Promise<CodexIntegrationAdapterSnapshot> {
    const client = await this.getClient();
    const cursors = new Set<string>();
    const threads: z.infer<typeof ThreadSummarySchema>[] = [];
    let cursor: string | null = null;
    do {
      let page: z.infer<typeof ThreadListResultSchema>;
      try {
        page = ThreadListResultSchema.parse(
          // oxlint-disable-next-line no-await-in-loop -- Pagination requests must follow the previous response cursor.
          await client.listThreads(paths, cursor)
        );
      } catch (error) {
        if (error instanceof CodexIntegrationUnavailableError) {
          throw error;
        }
        throw new CodexIntegrationUnavailableError(
          "Codex returned incompatible task metadata"
        );
      }
      threads.push(...page.data);
      cursor = page.nextCursor ?? null;
      if (cursor !== null) {
        if (cursors.has(cursor)) {
          throw new CodexIntegrationUnavailableError(
            "Codex returned a repeated pagination cursor"
          );
        }
        cursors.add(cursor);
      }
    } while (cursor !== null);
    const expectedPaths = new Set(paths);
    if (threads.some(({ cwd }) => !expectedPaths.has(cwd))) {
      throw new CodexIntegrationUnavailableError(
        "Codex returned a task outside the requested worktrees"
      );
    }
    return {
      tasks: threads.map((thread) => ({
        task: {
          activity: null,
          contextSharedAt: null,
          createdAt: timestamp(thread.createdAt),
          id: thread.id,
          title: thread.name ?? "Untitled Codex task",
          updatedAt: timestamp(thread.updatedAt),
        },
        worktreePath: thread.cwd,
      })),
      updatedAt: this.now().toISOString(),
    };
  }

  private getClient(): Promise<CodexAppServerClient> {
    if (!this.clientPromise) {
      const result = Promise.withResolvers<CodexAppServerClient>();
      const promise = result.promise;
      const resolve = async (): Promise<void> => {
        try {
          result.resolve(await this.resolveClient());
        } catch (error: unknown) {
          if (this.clientPromise === promise) {
            this.clientPromise = undefined;
          }
          result.reject(error);
        }
      };
      void resolve();
      this.clientPromise = promise;
    }
    return this.clientPromise;
  }

  private async resolveClient(): Promise<CodexAppServerClient> {
    const command = await resolveCodexCommand(
      this.commands,
      this.versionTimeoutMs
    );
    return new CodexAppServerClient(
      command,
      this.requestTimeoutMs,
      this.maxLineBytes
    );
  }
}
