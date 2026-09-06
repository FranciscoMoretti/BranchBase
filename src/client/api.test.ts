import { afterEach, describe, expect, it } from "bun:test";

import { fetchCodexIntegration, getJson, pickRepository } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Codex integration client", () => {
  it("loads the separately validated projection for a repository", async () => {
    const requests: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      requests.push(String(input));
      return Promise.resolve(
        Response.json({
          updatedAt: "2026-07-18T13:00:00.000Z",
          worktrees: { worktree: { tasks: [] } },
        })
      );
    }) as typeof fetch;

    await expect(fetchCodexIntegration("/repo with space")).resolves.toEqual({
      updatedAt: "2026-07-18T13:00:00.000Z",
      worktrees: { worktree: { tasks: [] } },
    });
    expect(requests).toEqual(["/api/codex?repoPath=%2Frepo+with+space"]);
  });
});

describe("request recovery", () => {
  it("normalizes transport failures and invalid responses", async () => {
    globalThis.fetch = ((_input: string | URL | Request) =>
      Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    await expect(getJson("/api/projects")).rejects.toMatchObject({
      code: "CONNECTION_UNAVAILABLE",
    });
    globalThis.fetch = ((_input: string | URL | Request) =>
      Promise.resolve(
        new Response("<html>unavailable</html>", { status: 503 })
      )) as typeof fetch;
    await expect(getJson("/api/projects")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("retries session acquisition after a connection failure rather than caching a rejected promise", async () => {
    let calls = 0;
    globalThis.fetch = ((input: string | URL | Request) => {
      if (String(input) === "/api/session") {
        calls++;
        return calls === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(Response.json({ token: "qa-token" }));
      }
      return Promise.resolve(Response.json({ path: null }));
    }) as typeof fetch;
    await expect(pickRepository()).rejects.toMatchObject({
      code: "CONNECTION_UNAVAILABLE",
    });
    await expect(pickRepository()).resolves.toBeNull();
    expect(calls).toBe(2);
  });
});
