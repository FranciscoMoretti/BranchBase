import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { MAX_BRANCHBASE_CONTEXT_BYTES } from "../codex/branchbase-context";
import {
  CODEX_HOOK_EVENTS,
  type CodexHookObservation,
} from "../codex/codex-hook-activity";

const MAX_HOOK_BODY = 16 * 1024;
const LoopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const CodexHookResponseSchema = z.object({
  additionalContext: z
    .string()
    .min(1)
    .max(MAX_BRANCHBASE_CONTEXT_BYTES)
    .optional(),
});

export interface CodexHookResponse {
  additionalContext?: string;
}

export const CodexHookObservationSchema = z
  .object({
    agentId: z.string().min(1).max(512).optional(),
    agentType: z.string().min(1).max(128).optional(),
    cwd: z.string().min(1).max(4096),
    event: z.enum(CODEX_HOOK_EVENTS),
    permissionMode: z.string().min(1).max(128).optional(),
    sessionId: z.string().min(1).max(512),
    source: z.enum(["startup", "resume", "clear", "compact"]).optional(),
    turnId: z.string().min(1).max(512).optional(),
    version: z.literal(1),
  })
  .strict();

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

interface RejectedRequest {
  error: string;
  status: number;
}

function bearerMatches(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function readHookBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_HOOK_BODY) {
      throw new RangeError("Codex hook body is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function rejectedRequest(
  request: IncomingMessage,
  token: string
): RejectedRequest | null {
  if (
    request.method !== "POST" ||
    request.url?.split("?", 1)[0] !== "/api/codex/hooks"
  ) {
    return { error: "Not found", status: 404 };
  }
  if (
    !LoopbackAddresses.has(request.socket.remoteAddress ?? "") ||
    request.headers.origin !== undefined ||
    !bearerMatches(request, token)
  ) {
    return { error: "Invalid Codex hook capability", status: 403 };
  }
  if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
    request.resume();
    return { error: "Codex hooks require application/json", status: 415 };
  }
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_HOOK_BODY) {
    request.resume();
    return { error: "Invalid Codex hook observation", status: 413 };
  }
  return null;
}

export function createCodexHookRequestHandler(options: {
  observe(observation: CodexHookObservation): CodexHookResponse | undefined;
  token: string;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const rejection = rejectedRequest(request, options.token);
    if (rejection) {
      sendJson(response, rejection.status, { error: rejection.error });
      return;
    }
    try {
      const observation = CodexHookObservationSchema.parse(
        await readHookBody(request)
      );
      let hookResponse: CodexHookResponse = {};
      try {
        const candidate = CodexHookResponseSchema.safeParse(
          options.observe(observation) ?? {}
        );
        if (
          candidate.success &&
          (!candidate.data.additionalContext ||
            Buffer.byteLength(candidate.data.additionalContext) <=
              MAX_BRANCHBASE_CONTEXT_BYTES)
        ) {
          hookResponse = candidate.data;
        }
      } catch {
        // Hook observation is optional and must never block Codex.
      }
      sendJson(response, 200, hookResponse);
    } catch (error) {
      sendJson(response, error instanceof RangeError ? 413 : 400, {
        error: "Invalid Codex hook observation",
      });
    }
  };
}
