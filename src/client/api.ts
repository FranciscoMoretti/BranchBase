import type { ZodType } from "zod";
import {
  type CodexIntegrationSnapshot,
  CodexIntegrationSnapshotSchema,
} from "../codex/codex-integration";
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

async function responseJson(response: Response): Promise<unknown> {
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
}

export async function request(
  path: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      signal:
        init?.signal ??
        (init?.method === "POST" ? undefined : AbortSignal.timeout(15_000)),
    });
  } catch {
    throw new BranchBaseApiError(
      "Connection to BranchBase is unavailable",
      "CONNECTION_UNAVAILABLE",
      null
    );
  }
}
export async function getJson(path: string): Promise<unknown> {
  return responseJson(await request(path));
}
function token(): Promise<string> {
  sessionToken ??= request("/api/session")
    .then(responseJson)
    .then((body) => SessionResponseSchema.parse(body).token)
    .catch((error: unknown) => {
      sessionToken = null;
      throw error;
    });
  return sessionToken;
}

export async function fetchWorkspace(
  repoPath: string
): Promise<WorkspaceSnapshot> {
  const query = new URLSearchParams({ repoPath });
  return WorkspaceSnapshotSchema.parse(
    await responseJson(await request(`/api/workspace?${query}`))
  );
}

export async function fetchCodexIntegration(
  repoPath: string
): Promise<CodexIntegrationSnapshot> {
  const query = new URLSearchParams({ repoPath });
  return CodexIntegrationSnapshotSchema.parse(
    await responseJson(await request(`/api/codex?${query}`))
  );
}

export async function fetchLogs(
  repoPath: string,
  worktreeId: string,
  appGroupName: string
): Promise<string[]> {
  const query = new URLSearchParams({ appGroupName, repoPath, worktreeId });
  const body = LogsResponseSchema.parse(
    await responseJson(await request(`/api/logs?${query}`))
  );
  return body.lines;
}

export function runCommand(
  command: string,
  input: Record<string, unknown>
): Promise<CommandReceipt> {
  return postCommand(command, input, CommandReceiptSchema);
}

async function postCommand<T>(
  command: string,
  input: Record<string, unknown>,
  schema: ZodType<T>
): Promise<T> {
  async function send(): Promise<Response> {
    return request(`/api/commands/${command}`, {
      body: JSON.stringify(input),
      headers: {
        "content-type": "application/json",
        "x-branchbase-token": await token(),
      },
      method: "POST",
    });
  }
  let response = await send();
  if (response.status === 403) {
    sessionToken = null;
    response = await send();
  }
  return schema.parse(await responseJson(response));
}

export function pickRepository(): Promise<string | null> {
  return postCommand("pick-repository", {}, PickRepositoryResultSchema).then(
    (result) => result.path
  );
}

export function previewRepositoryConfig(repoPath: string) {
  return postCommand(
    "preview-repository-config",
    { repoPath },
    RepositoryInitializationPlanSchema
  );
}

export function initializeRepository(repoPath: string) {
  return postCommand(
    "initialize-repository",
    { repoPath },
    RepositoryInitializationPlanSchema
  );
}
