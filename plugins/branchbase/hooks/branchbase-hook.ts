#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import pathModule from "node:path";

const EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
]);
const SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = MAX_CONTEXT_BYTES + 16 * 1024;

interface Capability {
  endpoint: string;
  pid: number;
  processStartMarker: string;
  token: string;
  version: 1;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}

function processStartMarker(pid: number): string {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf-8",
    timeout: 250,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readCapability(path: string): Capability {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode % 0o100 !== 0 ||
    (uid !== undefined && stat.uid !== uid)
  ) {
    throw new Error("Insecure BranchBase capability");
  }
  const value = JSON.parse(readFileSync(path, "utf-8")) as Record<
    string,
    unknown
  >;
  const endpoint = boundedString(value.endpoint, 2048);
  const processMarker = boundedString(value.processStartMarker, 256);
  const token = boundedString(value.token, 128);
  if (
    value.version !== 1 ||
    !endpoint ||
    !(Number.isInteger(value.pid) && Number(value.pid) > 0) ||
    !processMarker ||
    !token ||
    processStartMarker(Number(value.pid)) !== processMarker
  ) {
    throw new Error("Stale BranchBase capability");
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    !(url.hostname === "127.0.0.1" || url.hostname === "[::1]") ||
    url.pathname !== "/api/codex/hooks" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid BranchBase hook endpoint");
  }
  return {
    endpoint,
    pid: Number(value.pid),
    processStartMarker: processMarker,
    token,
    version: 1,
  };
}

async function readStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > MAX_STDIN_BYTES) {
      throw new Error("Hook input is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }
  const chunks: Buffer[] = [];
  const reader = response.body.getReader();
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks).toString("utf-8");
    }
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("BranchBase hook response is too large");
    }
    chunks.push(chunk);
  }
}

function normalize(event: string, raw: unknown): Record<string, unknown> {
  if (!(raw && typeof raw === "object" && !Array.isArray(raw))) {
    throw new Error("Invalid hook input");
  }
  const input = raw as Record<string, unknown>;
  const hookEvent = boundedString(input.hook_event_name, 64);
  const sessionId = boundedString(input.session_id, 512);
  const cwd = boundedString(input.cwd, 4096);
  if (!(EVENTS.has(event) && hookEvent === event && sessionId && cwd)) {
    throw new Error("Hook event mismatch");
  }
  const payload: Record<string, unknown> = {
    cwd,
    event,
    sessionId,
    version: 1,
  };
  const turnId = boundedString(input.turn_id, 512);
  const permissionMode = boundedString(input.permission_mode, 128);
  const agentId = boundedString(input.agent_id, 512);
  const agentType = boundedString(input.agent_type, 128);
  const source = boundedString(input.source, 32);
  if (turnId) {
    payload.turnId = turnId;
  }
  if (permissionMode) {
    payload.permissionMode = permissionMode;
  }
  if (agentId) {
    payload.agentId = agentId;
  }
  if (agentType) {
    payload.agentType = agentType;
  }
  if (source && SOURCES.has(source)) {
    payload.source = source;
  }
  return payload;
}

async function main(): Promise<unknown> {
  const event = process.argv[2] ?? "";
  const capabilityPath =
    process.env.BRANCHBASE_CODEX_CAPABILITY_PATH ??
    pathModule.join(homedir(), ".branchbase", "codex", "capability.json");
  const [capability, input] = await Promise.all([
    Promise.resolve().then(() => readCapability(capabilityPath)),
    readStdin(),
  ]);
  const payload = normalize(event, input);
  const response = await fetch(capability.endpoint, {
    body: JSON.stringify(payload),
    headers: {
      authorization: `Bearer ${capability.token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(650),
  });
  if (!response.ok) {
    return {};
  }
  const responseText = await readBoundedResponse(response);
  const body = JSON.parse(responseText) as Record<string, unknown>;
  const context = boundedString(body.additionalContext, MAX_CONTEXT_BYTES);
  if (
    context &&
    Buffer.byteLength(context) <= MAX_CONTEXT_BYTES &&
    (event === "SessionStart" || event === "UserPromptSubmit")
  ) {
    return {
      hookSpecificOutput: {
        additionalContext: context,
        hookEventName: event,
      },
    };
  }
  return {};
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch {
  process.stdout.write("{}\n");
}
