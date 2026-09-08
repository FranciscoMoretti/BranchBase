import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { once } from "node:events";
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
      },
      token: "hook-secret",
    });
    server = createServer((request, response) => {
      handler(request, response).catch(() => response.end());
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    if (!(address && typeof address === "object")) {
      throw new Error("Missing test server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    const closed = once(server, "close");
    server.close();
    await closed;
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
    const listening = once(contextServer, "listening");
    contextServer.listen(0, "127.0.0.1");
    await listening;
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
      const closed = once(contextServer, "close");
      contextServer.close();
      await closed;
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

    const wrongToken = await request({ authorization: "Bearer wrong" });
    expect(wrongToken.status).toBe(403);
    const browserOrigin = await request({
      authorization: "Bearer hook-secret",
      origin: "https://example.com",
    });
    expect(browserOrigin.status).toBe(403);
    const contentBearing = await request(
      { authorization: "Bearer hook-secret" },
      { ...payload, prompt: "must not cross the bridge" }
    );
    expect(contentBearing.status).toBe(400);
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

    const wrongContentType = await request("{}", "text/plain");
    expect(wrongContentType.status).toBe(415);
    const oversized = await request(
      JSON.stringify({ padding: "x".repeat(17 * 1024) }),
      "application/json"
    );
    expect(oversized.status).toBe(413);
    expect(observations).toEqual([]);
  });
});
