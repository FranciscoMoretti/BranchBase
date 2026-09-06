import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join } from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createCodexHookCapability } from "../codex/codex-hook-capability";
import {
  CodexIntegrationSnapshotSchema,
  CodexIntegrationUnavailableError,
} from "../codex/codex-integration";
import { AppGroupLifecycleError } from "../controller/app-group-lifecycle-error";
import { isBranchBaseCommandName } from "../controller/command-contract";
import {
  FoldersResponseSchema,
  ObservationSchema,
} from "../controller/discovery-contract";
import {
  ActivityResponseSchema,
  ProjectsResponseSchema,
} from "../controller/product-contract";
import {
  MissingWorktreeConfigError,
  WorkspaceController,
} from "../controller/workspace-controller";
import { WorkspaceSnapshotSchema } from "../controller/workspace-snapshot";
import { processStartMarker } from "../host/process-inspection";
import { createCodexHookRequestHandler } from "./codex-hook-route";
import {
  LogsQuerySchema,
  LogsResponseSchema,
  WorkspaceQuerySchema,
} from "./schemas";

const MAX_BODY = 64 * 1024;
const COMMAND_PATH = /^\/api\/commands\/([a-z-]+)$/;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};

export type BranchBaseServerController = Pick<
  WorkspaceController,
  "close" | "execute" | "handleCodexHook" | "inspect" | "inspectCodex" | "logs"
> &
  Partial<
    Pick<
      WorkspaceController,
      "projects" | "activity" | "observeRepository" | "developmentFolders"
    >
  >;

export interface BranchBaseServerOptions {
  appRoot: string;
  codexControlDirectory?: string;
  controller?: BranchBaseServerController;
  development?: boolean;
  enableCodexHooks?: boolean;
  host?: string;
  port?: number;
}

export interface BranchBaseServer {
  close(): Promise<void>;
  listen(): Promise<string>;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function errorBody(error: unknown) {
  if (error instanceof CodexIntegrationUnavailableError) {
    return { code: error.code, error: error.message };
  }
  if (error instanceof MissingWorktreeConfigError) {
    return {
      code: error.code,
      configPath: error.configPath,
      error: error.message,
    };
  }
  if (error instanceof AppGroupLifecycleError) {
    return { code: error.code, error: error.message };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

function httpOrigin(host: string, port: number): string {
  const urlHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${urlHost}:${port}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY) {
      throw new Error("Request body is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function createBranchBaseServer(
  options: BranchBaseServerOptions
): Promise<BranchBaseServer> {
  const controller = options.controller ?? new WorkspaceController();
  const host = options.host ?? "127.0.0.1";
  const configuredPort = options.port ?? 3999;
  const token = randomBytes(32).toString("base64url");
  const vite: ViteDevServer | null = options.development
    ? await createViteServer({
        appType: "spa",
        root: options.appRoot,
        server: { middlewareMode: true },
      })
    : null;
  let codexHookCapability: ReturnType<typeof createCodexHookCapability> | null =
    null;
  let handleCodexHook: ReturnType<typeof createCodexHookRequestHandler> | null =
    null;
  let exitCleanupRegistered = false;
  let listeningUrl: string | null = null;
  let shutdownPromise: Promise<void> | null = null;

  function authorized(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const expectedOrigin = `http://${request.headers.host}`;
    return (
      request.headers["x-branchbase-token"] === token &&
      (!origin || origin === expectedOrigin)
    );
  }

  function handleDiscoveryGet(url: URL, response: ServerResponse): boolean {
    if (url.pathname === "/api/observation") {
      sendJson(
        response,
        200,
        ObservationSchema.parse(
          controller.observeRepository?.(url.searchParams.get("repoPath") ?? "")
        )
      );
      return true;
    }
    if (url.pathname === "/api/development-folders") {
      sendJson(
        response,
        200,
        FoldersResponseSchema.parse({
          folders: controller.developmentFolders?.() ?? [],
        })
      );
      return true;
    }
    return false;
  }
  async function handleGetApi(
    url: URL,
    response: ServerResponse
  ): Promise<boolean> {
    if (handleDiscoveryGet(url, response)) {
      return true;
    }
    if (url.pathname === "/api/projects") {
      sendJson(
        response,
        200,
        ProjectsResponseSchema.parse({
          projects: controller.projects?.() ?? [],
        })
      );
      return true;
    }
    if (url.pathname === "/api/activity") {
      sendJson(
        response,
        200,
        ActivityResponseSchema.parse({
          events:
            controller.activity?.(
              url.searchParams.get("repoPath") ?? undefined
            ) ?? [],
        })
      );
      return true;
    }
    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        service: "branchbase",
      });
      return true;
    }
    if (url.pathname === "/api/session") {
      sendJson(response, 200, { token });
      return true;
    }
    if (url.pathname === "/api/workspace") {
      const { repoPath } = WorkspaceQuerySchema.parse(
        Object.fromEntries(url.searchParams)
      );
      sendJson(
        response,
        200,
        WorkspaceSnapshotSchema.parse(controller.inspect(repoPath))
      );
      return true;
    }
    if (url.pathname === "/api/codex") {
      const { repoPath } = WorkspaceQuerySchema.parse(
        Object.fromEntries(url.searchParams)
      );
      sendJson(
        response,
        200,
        CodexIntegrationSnapshotSchema.parse(
          await controller.inspectCodex(repoPath)
        )
      );
      return true;
    }
    if (url.pathname !== "/api/logs") {
      return false;
    }
    const { appGroupName, repoPath, worktreeId } = LogsQuerySchema.parse(
      Object.fromEntries(url.searchParams)
    );
    sendJson(
      response,
      200,
      LogsResponseSchema.parse({
        lines: controller.logs(repoPath, worktreeId, appGroupName),
      })
    );
    return true;
  }

  async function handleCommand(
    request: IncomingMessage,
    response: ServerResponse,
    command: string
  ): Promise<void> {
    if (!authorized(request)) {
      sendJson(response, 403, { error: "Invalid mutation session" });
      return;
    }
    if (
      !(request.headers["content-type"] ?? "").startsWith("application/json")
    ) {
      sendJson(response, 415, { error: "Commands require application/json" });
      return;
    }
    if (!isBranchBaseCommandName(command)) {
      sendJson(response, 404, { error: "Unknown command" });
      return;
    }
    const result = await controller.execute(command, await readJson(request));
    sendJson(response, 200, result);
  }

  function serveUi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL
  ): void {
    if (vite) {
      vite.middlewares(request, response, (error: unknown) => {
        if (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        } else {
          response.writeHead(404).end("Not found");
        }
      });
      return;
    }
    const requested =
      url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = join(options.appRoot, "dist", requested);
    if (!(existsSync(file) && statSync(file).isFile())) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      request.headers.host
        ? `http://${request.headers.host}`
        : httpOrigin(host, configuredPort)
    );
    try {
      if (
        handleCodexHook &&
        request.method === "POST" &&
        url.pathname === "/api/codex/hooks"
      ) {
        await handleCodexHook(request, response);
        return;
      }
      if (request.method === "GET" && (await handleGetApi(url, response))) {
        return;
      }
      const commandMatch =
        request.method === "POST" ? COMMAND_PATH.exec(url.pathname) : null;
      if (commandMatch) {
        await handleCommand(request, response, commandMatch[1]);
        return;
      }
      serveUi(request, response, url);
    } catch (error) {
      sendJson(
        response,
        error instanceof CodexIntegrationUnavailableError ? 503 : 400,
        errorBody(error)
      );
    }
  });

  function closeHttpServer(): Promise<void> {
    if (!server.listening) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function enableCodexHookBridge(port: number): void {
    if (options.enableCodexHooks === false) {
      return;
    }
    try {
      codexHookCapability = createCodexHookCapability({
        ...(options.codexControlDirectory
          ? { directory: options.codexControlDirectory }
          : {}),
        endpoint: `${httpOrigin(host, port)}/api/codex/hooks`,
        pid: process.pid,
        processStartMarker: processStartMarker(process.pid),
      });
      handleCodexHook = createCodexHookRequestHandler({
        observe: (observation) => controller.handleCodexHook(observation),
        token: codexHookCapability.record.token,
      });
      if (!exitCleanupRegistered) {
        process.once("exit", cleanupCodexHookCapability);
        exitCleanupRegistered = true;
      }
    } catch {
      codexHookCapability = null;
      handleCodexHook = null;
    }
  }

  function cleanupCodexHookCapability(): void {
    codexHookCapability?.cleanup();
  }

  return {
    close(): Promise<void> {
      shutdownPromise ??= Promise.all([
        closeHttpServer(),
        controller.close(),
        vite?.close() ?? Promise.resolve(),
      ])
        .then(() => undefined)
        .finally(() => {
          if (exitCleanupRegistered) {
            process.off("exit", cleanupCodexHookCapability);
            exitCleanupRegistered = false;
          }
          cleanupCodexHookCapability();
        });
      return shutdownPromise;
    },
    listen(): Promise<string> {
      if (listeningUrl) {
        return Promise.resolve(listeningUrl);
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(configuredPort, host, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("BranchBase server did not bind a TCP port"));
            return;
          }
          enableCodexHookBridge(address.port);
          listeningUrl = `${httpOrigin(host, address.port)}/`;
          resolve(listeningUrl);
        });
      });
    },
  };
}
