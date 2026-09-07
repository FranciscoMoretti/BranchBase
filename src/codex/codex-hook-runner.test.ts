import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { spawn } from "bun";

import { processStartMarker } from "../host/process-inspection";
import { createCodexHookCapability } from "./codex-hook-capability";

const PLUGIN_ROOT = pathModule.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "branchbase"
);
const RUNNER = pathModule.join(PLUGIN_ROOT, "hooks", "branchbase-hook");

describe("BranchBase Codex hook runner", () => {
  const requests: unknown[] = [];
  let capabilityDirectory = "";
  let endpoint = "";
  let hookResponse: unknown;
  let server: Server;

  beforeEach(async () => {
    requests.length = 0;
    hookResponse = {};
    capabilityDirectory = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-hook-runner-")
    );
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(hookResponse));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!(address && typeof address === "object")) {
      throw new Error("Missing runner test server address");
    }
    endpoint = `http://127.0.0.1:${address.port}/api/codex/hooks`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(capabilityDirectory, { force: true, recursive: true });
  });

  async function run(event: string, input: unknown, capabilityPath: string) {
    const child = spawn([RUNNER, event], {
      env: {
        ...process.env,
        PLUGIN_ROOT,
        BRANCHBASE_CODEX_CAPABILITY_PATH: capabilityPath,
      },
      stderr: "pipe",
      stdin: new Blob([JSON.stringify(input)]),
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr, stdout };
  }

  it("forwards only allowlisted lifecycle metadata and exits successfully", async () => {
    const capability = createCodexHookCapability({
      directory: capabilityDirectory,
      endpoint,
      pid: process.pid,
      processStartMarker: processStartMarker(process.pid),
    });

    const result = await run(
      "UserPromptSubmit",
      {
        cwd: "/repo/worktree",
        hook_event_name: "UserPromptSubmit",
        model: "private-model-value",
        permission_mode: "default",
        prompt: "private prompt",
        session_id: "task-a",
        transcript_path: "/private/transcript.jsonl",
        turn_id: "turn-1",
      },
      capability.file
    );

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(requests).toEqual([
      {
        cwd: "/repo/worktree",
        event: "UserPromptSubmit",
        permissionMode: "default",
        sessionId: "task-a",
        turnId: "turn-1",
        version: 1,
      },
    ]);
  });

  it("fails open without a capability or when the fixed event mismatches", async () => {
    const missing = await run(
      "Stop",
      {
        cwd: "/repo/worktree",
        hook_event_name: "Stop",
        session_id: "task-a",
      },
      pathModule.join(capabilityDirectory, "missing.json")
    );
    expect(missing).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });

    const staleCapability = createCodexHookCapability({
      directory: capabilityDirectory,
      endpoint,
      pid: process.pid,
      processStartMarker: "stale-process-start",
    });
    const stale = await run(
      "Stop",
      {
        cwd: "/repo/worktree",
        hook_event_name: "Stop",
        session_id: "task-a",
      },
      staleCapability.file
    );
    expect(stale).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });

    const capability = createCodexHookCapability({
      directory: capabilityDirectory,
      endpoint,
      pid: process.pid,
      processStartMarker: processStartMarker(process.pid),
    });
    const mismatch = await run(
      "Stop",
      {
        cwd: "/repo/worktree",
        hook_event_name: "UserPromptSubmit",
        session_id: "task-a",
      },
      capability.file
    );
    expect(mismatch).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(requests).toEqual([]);
  });

  it("wraps bounded server context only for model-visible hook events", async () => {
    hookResponse = { additionalContext: "Safe BranchBase context" };
    const capability = createCodexHookCapability({
      directory: capabilityDirectory,
      endpoint,
      pid: process.pid,
      processStartMarker: processStartMarker(process.pid),
    });

    const result = await run(
      "SessionStart",
      {
        cwd: "/repo/worktree",
        hook_event_name: "SessionStart",
        permission_mode: "default",
        session_id: "task-a",
        source: "resume",
      },
      capability.file
    );

    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        additionalContext: "Safe BranchBase context",
        hookEventName: "SessionStart",
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    hookResponse = { additionalContext: "x".repeat(17 * 1024) };
    const largerContext = await run(
      "UserPromptSubmit",
      {
        cwd: "/repo/worktree",
        hook_event_name: "UserPromptSubmit",
        session_id: "task-a",
        turn_id: "turn-2",
      },
      capability.file
    );
    expect(JSON.parse(largerContext.stdout)).toEqual({
      hookSpecificOutput: {
        additionalContext: "x".repeat(17 * 1024),
        hookEventName: "UserPromptSubmit",
      },
    });

    hookResponse = { additionalContext: "x".repeat(65 * 1024) };
    const oversized = await run(
      "UserPromptSubmit",
      {
        cwd: "/repo/worktree",
        hook_event_name: "UserPromptSubmit",
        session_id: "task-a",
        turn_id: "turn-3",
      },
      capability.file
    );
    expect(oversized).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
  });

  it("fails open before transport when stdin exceeds the privacy limit", async () => {
    const capability = createCodexHookCapability({
      directory: capabilityDirectory,
      endpoint,
      pid: process.pid,
      processStartMarker: processStartMarker(process.pid),
    });
    const result = await run(
      "Stop",
      {
        cwd: "/repo/worktree",
        hook_event_name: "Stop",
        padding: "x".repeat(1024 * 1024),
        session_id: "task-a",
      },
      capability.file
    );

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(requests).toEqual([]);
  });
});
