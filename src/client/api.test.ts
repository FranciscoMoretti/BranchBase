import { afterEach, describe, expect, expectTypeOf, it } from "bun:test";

import {
  fetchCodexIntegration,
  getJson,
  pickRepository,
  runCommand,
} from "./api";

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
  it("distinguishes request timeouts from caller cancellation", async () => {
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    globalThis.fetch = ((_input: string | URL | Request) =>
      Promise.reject(timeout)) as typeof fetch;
    await expect(getJson("/api/projects")).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });

    const abort = new Error("cancelled");
    abort.name = "AbortError";
    globalThis.fetch = ((_input: string | URL | Request) =>
      Promise.reject(abort)) as typeof fetch;
    await expect(getJson("/api/projects")).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("retries session acquisition after a connection failure rather than caching a rejected promise", async () => {
    let calls = 0;
    globalThis.fetch = ((input: string | URL | Request) => {
      if (String(input) === "/api/session") {
        calls += 1;
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

describe("typed commands", () => {
  it("rejects incomplete inputs before making a request", async () => {
    let requests = 0;
    globalThis.fetch = ((_input: string | URL | Request) => {
      requests += 1;
      return Promise.reject(new Error("Unexpected request"));
    }) as typeof fetch;
    await expect(
      // @ts-expect-error App group commands require both the worktree and group.
      runCommand("start-apps", { repoPath: "/repo" })
    ).rejects.toThrow();
    // @ts-expect-error Unknown commands must not compile either.
    await expect(runCommand("unknown-command", {})).rejects.toThrow();
    expect(requests).toBe(0);
  });
  it("infers each result and validates server output", async () => {
    globalThis.fetch = ((input: string | URL | Request) =>
      Promise.resolve(
        Response.json(
          String(input) === "/api/session"
            ? { token: "qa-token" }
            : { path: "/repo" }
        )
      )) as typeof fetch;
    const result = await runCommand("pick-repository", {});
    expectTypeOf(result).toEqualTypeOf<{ path: string | null }>();
    expect(result.path).toBe("/repo");
    await expect(
      runCommand("stop-apps", {
        appGroupName: "web",
        repoPath: "/repo",
        worktreeId: "main",
      })
    ).rejects.toThrow();
  });
});
