import { expect, test } from "bun:test";

import { DaemonClient } from "./client";
import { runCli } from "./run";

test("CLI validates commands before transport and sends the daemon session", async () => {
  const calls: string[] = [];
  const client = new DaemonClient("http://localhost:3999", (url, init) => {
    calls.push(url.pathname);
    if (url.pathname === "/api/session") {
      return Promise.resolve(Response.json({ token: "test-session" }));
    }
    expect(new Headers(init?.headers).get("x-branchbase-token")).toBe(
      "test-session"
    );
    expect(init?.method).toBe("POST");
    return Promise.resolve(
      Response.json({
        command: "clear-logs",
        message: "Logs cleared",
        ok: true,
      })
    );
  });
  await expect(client.execute("start-apps", {})).rejects.toThrow();
  expect(calls).toEqual([]);
  expect(
    await runCli(
      [
        "execute",
        "clear-logs",
        "--input",
        JSON.stringify({
          appGroupName: "development",
          repoPath: "/repo",
          worktreeId: "main",
        }),
      ],
      client,
      "/repo"
    )
  ).toBe("Logs cleared");
  expect(calls).toEqual(["/api/session", "/api/commands/clear-logs"]);
});

test("CLI project status uses the same headless status query and defaults to cwd", async () => {
  const client = new DaemonClient("http://localhost:3999", (url) => {
    expect(url.pathname).toBe("/api/project-status");
    expect(url.searchParams.get("repoPath")).toBe("/code/project");
    return Promise.resolve(
      Response.json({ configuration: { state: "unconfigured" } })
    );
  });
  const output = await runCli(
    ["project", "status", "--json"],
    client,
    "/code/project"
  );
  expect(JSON.parse(output)).toEqual({
    configuration: { state: "unconfigured" },
  });
});

test("CLI never replays a command after an ambiguous connection failure", async () => {
  let posts = 0;
  const client = new DaemonClient("http://localhost:3999", (url) => {
    if (url.pathname === "/api/session") {
      return Promise.resolve(Response.json({ token: "test-session" }));
    }
    posts += 1;
    return Promise.reject(new Error("Connection lost"));
  });
  await expect(client.execute("scan-development-folders", {})).rejects.toThrow(
    "Connection lost"
  );
  expect(posts).toBe(1);
});

test("CLI reports a daemon that is unavailable without rewriting the transport error", async () => {
  const client = new DaemonClient("http://127.0.0.1:3999", () =>
    Promise.reject(new Error("Failed to connect to daemon"))
  );
  await expect(runCli(["project", "list"], client, "/repo")).rejects.toThrow(
    "Failed to connect to daemon"
  );
});
