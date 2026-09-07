import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createServer } from "node:http";
import type { Server } from "node:http";

import type { CodexHookObservation } from "../codex/codex-hook-activity";
import { createCodexHookRequestHandler } from "./codex-hook-route";

describe("Codex hook HTTP route", () => {
  const observations: CodexHookObservation[] = [];
  let baseUrl = "";
  let server: Server;

  beforeEach(async () => {
    observations.length = 0;
    const handler = createCodexHookRequestHandler({
      observe: (observation) => {
        observations.push(observation);
        return undefined;
      },
      token: "hook-secret",
    });
    server = createServer((request, response) => {
      handler(request, response).catch(() => response.end());
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!(address && typeof address === "object")) {
      throw new Error("Missing test server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("accepts only a strict allowlisted observation with the hook capability", async () => {
    const response = await fetch(`${baseUrl}/api/codex/hooks`, {
      body: JSON.stringify({
        cwd: "/repo/worktree",
        event: "PermissionRequest",
        permissionMode: "default",
        sessionId: "task-a",
        turnId: "turn-1",
        version: 1,
      }),
      headers: {
        authorization: "Bearer hook-secret",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(observations).toEqual([
      {
        cwd: "/repo/worktree",
        event: "PermissionRequest",
        permissionMode: "default",
        sessionId: "task-a",
        turnId: "turn-1",
        version: 1,
      },
    ]);
  });

  it("returns the safe context produced while handling a model-visible event", async () => {
    const contextServer = createServer((request, response) => {
      createCodexHookRequestHandler({
        observe: () => ({ additionalContext: "Safe BranchBase context" }),
        token: "hook-secret",
      })(request, response).catch(() => response.end());
    });
    await new Promise<void>((resolve) => {
      contextServer.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = contextServer.address();
      if (!(address && typeof address === "object")) {
        throw new Error("Missing context test server address");
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/codex/hooks`,
        {
          body: JSON.stringify({
            cwd: "/repo/worktree",
            event: "SessionStart",
            sessionId: "task-a",
            source: "resume",
            version: 1,
          }),
          headers: {
            authorization: "Bearer hook-secret",
            "content-type": "application/json",
          },
          method: "POST",
        }
      );

      expect(await response.json()).toEqual({
        additionalContext: "Safe BranchBase context",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        contextServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects browser origins, invalid tokens, and content-bearing fields", async () => {
    const payload = {
      cwd: "/repo/worktree",
      event: "UserPromptSubmit",
      sessionId: "task-a",
      version: 1,
    };
    const request = (
      headers: Record<string, string>,
      body: unknown = payload
    ) =>
      fetch(`${baseUrl}/api/codex/hooks`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      });

    expect((await request({ authorization: "Bearer wrong" })).status).toBe(403);
    expect(
      (
        await request({
          authorization: "Bearer hook-secret",
          origin: "https://example.com",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(
          { authorization: "Bearer hook-secret" },
          { ...payload, prompt: "must not cross the bridge" }
        )
      ).status
    ).toBe(400);
    expect(observations).toEqual([]);
  });

  it("rejects oversized and non-JSON bodies before observation", async () => {
    const request = (body: string, contentType: string) =>
      fetch(`${baseUrl}/api/codex/hooks`, {
        body,
        headers: {
          authorization: "Bearer hook-secret",
          "content-type": contentType,
        },
        method: "POST",
      });

    expect((await request("{}", "text/plain")).status).toBe(415);
    expect(
      (
        await request(
          JSON.stringify({ padding: "x".repeat(17 * 1024) }),
          "application/json"
        )
      ).status
    ).toBe(413);
    expect(observations).toEqual([]);
  });
});
