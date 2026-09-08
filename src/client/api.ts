import type { ZodType } from "zod";

import { CodexIntegrationSnapshotSchema } from "../codex/codex-integration";
import type { CodexIntegrationSnapshot } from "../codex/codex-integration";
import {
  CommandReceiptSchema,
  PickRepositoryResultSchema,
  RepositoryInitializationPlanSchema,
} from "../controller/command-contract";
import type {
  CommandReceipt,
  WorkspaceSnapshot,
} from "../controller/workspace-snapshot";
import { WorkspaceSnapshotSchema } from "../controller/workspace-snapshot";
import { LogsResponseSchema, SessionResponseSchema } from "../server/schemas";

let sessionToken: Promise<string> | null = null;

export class BranchBaseApiError extends Error {
  readonly code: string | null;
  readonly configPath: string | null;

  constructor(message: string, code: string | null, configPath: string | null) {
    super(message);
    this.code = code;
    this.configPath = configPath;
    this.name = "BranchBaseApiError";
  }
}

const responseJson = async (response: Response): Promise<unknown> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BranchBaseApiError(
      `Invalid server response (${response.status})`,
      "INVALID_RESPONSE",
      null
    );
  }
  if (!response.ok) {
    const value =
      body && typeof body === "object"
        ? (body as {
            code?: unknown;
            configPath?: unknown;
            error?: unknown;
          })
        : {};
    throw new BranchBaseApiError(
      typeof value.error === "string"
        ? value.error
        : `Request failed (${response.status})`,
      typeof value.code === "string" ? value.code : null,
      typeof value.configPath === "string" ? value.configPath : null
    );
  }
  return body;
};

export const request = async (
  path: string,
  init?: RequestInit
): Promise<Response> => {
  try {
    return await fetch(path, {
      ...init,
      signal:
        init?.signal ??
        (init?.method === "POST" ? undefined : AbortSignal.timeout(15_000)),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new BranchBaseApiError(
        "BranchBase did not respond before the request timed out",
        "REQUEST_TIMEOUT",
        null
      );
    }
    throw new BranchBaseApiError(
      "Connection to BranchBase is unavailable",
      "CONNECTION_UNAVAILABLE",
      null
    );
  }
};
export const getJson = async (path: string): Promise<unknown> =>
  responseJson(await request(path));
const token = (): Promise<string> => {
  if (!sessionToken) {
    sessionToken = (async () => {
      try {
        const body = await responseJson(await request("/api/session"));
        return SessionResponseSchema.parse(body).token;
      } catch (error: unknown) {
        sessionToken = null;
        throw error;
      }
    })();
  }
  return sessionToken;
};

export const fetchWorkspace = async (
  repoPath: string
): Promise<WorkspaceSnapshot> => {
  const query = new URLSearchParams({ repoPath });
  return WorkspaceSnapshotSchema.parse(
    await responseJson(await request(`/api/workspace?${query}`))
  );
};

export const fetchCodexIntegration = async (
  repoPath: string
): Promise<CodexIntegrationSnapshot> => {
  const query = new URLSearchParams({ repoPath });
  return CodexIntegrationSnapshotSchema.parse(
    await responseJson(await request(`/api/codex?${query}`))
  );
};

export const fetchLogs = async (
  repoPath: string,
  worktreeId: string,
  appGroupName: string
): Promise<string[]> => {
  const query = new URLSearchParams({ appGroupName, repoPath, worktreeId });
  const body = LogsResponseSchema.parse(
    await responseJson(await request(`/api/logs?${query}`))
  );
  return body.lines;
};

const postCommand = async <T>(
  command: string,
  input: Record<string, unknown>,
  schema: ZodType<T>
): Promise<T> => {
  const send = async (): Promise<Response> =>
    request(`/api/commands/${command}`, {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-branchbase-token": await token(),
      },
      method: "POST",
    });
  let response = await send();
  if (response.status === 403) {
    sessionToken = null;
    response = await send();
  }
  return schema.parse(await responseJson(response));
};

export const runCommand = (
  command: string,
  input: Record<string, unknown>
): Promise<CommandReceipt> => postCommand(command, input, CommandReceiptSchema);

export const pickRepository = async (): Promise<string | null> => {
  const result = await postCommand(
    "pick-repository",
    {},
    PickRepositoryResultSchema
  );
  return result.path;
};

export const previewRepositoryConfig = (repoPath: string) =>
  postCommand(
    "preview-repository-config",
    { repoPath },
    RepositoryInitializationPlanSchema
  );

export const initializeRepository = (repoPath: string) =>
  postCommand(
    "initialize-repository",
    { repoPath },
    RepositoryInitializationPlanSchema
  );
