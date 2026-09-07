import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";
import { fileURLToPath } from "node:url";

import { CodexIntegrationUnavailableError } from "./codex-integration";
import { CodexTaskDiscoveryAdapter } from "./codex-task-discovery";

const openAdapters: CodexTaskDiscoveryAdapter[] = [];
const localIntegrationIt =
  process.env.BRANCHBASE_CODEX_INTEGRATION === "1" ? it : it.skip;

const fakeCommand = (
  scenario: string,
  env: Readonly<Record<string, string>> = {}
) => ({
  args: [
    fileURLToPath(
      new URL("fixtures/fake-codex-app-server.ts", import.meta.url)
    ),
  ],
  executable: process.execPath,
  env: { ...env, BRANCHBASE_FAKE_CODEX_SCENARIO: scenario },
});

const fakeAdapter = (
  scenario: string,
  options: { requestTimeoutMs?: number } = {}
): CodexTaskDiscoveryAdapter => {
  const adapter = new CodexTaskDiscoveryAdapter({
    command: fakeCommand(scenario),
    now: () => new Date("2026-07-18T15:00:00.000Z"),
    requestTimeoutMs: options.requestTimeoutMs,
  });
  openAdapters.push(adapter);
  return adapter;
};

afterEach(async () => {
  await Promise.all(openAdapters.splice(0).map((adapter) => adapter.close()));
});

describe("persisted Codex task discovery", () => {
  it("projects only safe metadata for exact requested worktree roots", async () => {
    const adapter = fakeAdapter("single-page");

    await expect(
      adapter.loadAssociatedTasks([
        { id: "worktree-a", path: "/canonical/a" },
        { id: "worktree-b", path: "/canonical/b" },
      ])
    ).resolves.toEqual({
      tasks: [
        {
          task: {
            activity: null,
            contextSharedAt: null,
            createdAt: "1970-01-01T00:00:00.000Z",
            id: "task-a",
            title: "Untitled Codex task",
            updatedAt: "1970-01-01T00:00:02.000Z",
          },
          worktreePath: "/canonical/a",
        },
        {
          task: {
            activity: null,
            contextSharedAt: null,
            createdAt: "1970-01-01T00:00:01.000Z",
            id: "task-b",
            title: "Named task",
            updatedAt: "1970-01-01T00:00:03.000Z",
          },
          worktreePath: "/canonical/b",
        },
      ],
      updatedAt: "2026-07-18T15:00:00.000Z",
    });
  });

  it("fully paginates the safe non-archived interactive query", async () => {
    const adapter = fakeAdapter("pagination");

    const snapshot = await adapter.loadAssociatedTasks([
      { id: "worktree-a", path: "/canonical/a" },
    ]);

    expect(snapshot.tasks.map(({ task }) => task.id)).toEqual([
      "task-first-page",
      "task-second-page",
    ]);
  });

  it("coalesces concurrent refreshes and caches successful discovery", async () => {
    let now = new Date("2026-07-18T15:00:00.000Z");
    const adapter = new CodexTaskDiscoveryAdapter({
      command: fakeCommand("changing"),
      now: () => now,
      successfulTtlMs: 30_000,
    });
    openAdapters.push(adapter);
    const worktrees = [{ id: "worktree-a", path: "/canonical/a" }];

    const concurrent = await Promise.all([
      adapter.loadAssociatedTasks(worktrees),
      adapter.loadAssociatedTasks(worktrees),
    ]);
    const cached = await adapter.loadAssociatedTasks(worktrees);
    const forced = await adapter.loadAssociatedTasks(worktrees, {
      force: true,
    });
    now = new Date("2026-07-18T15:00:31.000Z");
    const refreshed = await adapter.loadAssociatedTasks(worktrees);

    expect(concurrent.map((snapshot) => snapshot.tasks[0]?.task.id)).toEqual([
      "task-request-1",
      "task-request-1",
    ]);
    expect(cached.tasks[0]?.task.id).toBe("task-request-1");
    expect(forced.tasks[0]?.task.id).toBe("task-request-2");
    expect(refreshed.tasks[0]?.task.id).toBe("task-request-3");
  });

  it("rejects a repeated pagination cursor instead of looping", async () => {
    const adapter = fakeAdapter("repeated-cursor", { requestTimeoutMs: 2000 });

    await expect(
      adapter.loadAssociatedTasks([{ id: "worktree-a", path: "/canonical/a" }])
    ).rejects.toEqual(
      new CodexIntegrationUnavailableError(
        "Codex returned a repeated pagination cursor"
      )
    );
  });

  it("negative-caches failures before allowing a controlled retry", async () => {
    let now = new Date("2026-07-18T15:00:00.000Z");
    const adapter = new CodexTaskDiscoveryAdapter({
      command: fakeCommand("transient-timeout"),
      negativeTtlMs: 5000,
      now: () => now,
      requestTimeoutMs: 2000,
    });
    openAdapters.push(adapter);
    const worktrees = [{ id: "worktree-a", path: "/canonical/a" }];

    await expect(adapter.loadAssociatedTasks(worktrees)).rejects.toEqual(
      new CodexIntegrationUnavailableError("Codex request timed out")
    );
    await expect(adapter.loadAssociatedTasks(worktrees)).rejects.toEqual(
      new CodexIntegrationUnavailableError("Codex request timed out")
    );
    now = new Date("2026-07-18T15:00:06.000Z");

    await expect(adapter.loadAssociatedTasks(worktrees)).resolves.toMatchObject(
      {
        tasks: [{ task: { id: "task-recovered" } }],
      }
    );
  });

  it("fails closed for malformed, misassociated, and incompatible responses", async () => {
    const worktrees = [{ id: "worktree-a", path: "/canonical/a" }];

    await expect(
      fakeAdapter("malformed-row").loadAssociatedTasks(worktrees)
    ).rejects.toBeInstanceOf(CodexIntegrationUnavailableError);
    await expect(
      fakeAdapter("wrong-cwd").loadAssociatedTasks(worktrees)
    ).rejects.toEqual(
      new CodexIntegrationUnavailableError(
        "Codex returned a task outside the requested worktrees"
      )
    );
    await expect(
      fakeAdapter("unsupported").loadAssociatedTasks(worktrees)
    ).rejects.toEqual(
      new CodexIntegrationUnavailableError(
        "Codex does not support safe task discovery"
      )
    );
  });

  it("contains executable and app-server process failures", async () => {
    const worktrees = [{ id: "worktree-a", path: "/canonical/a" }];
    const missing = new CodexTaskDiscoveryAdapter({
      command: { executable: "/missing/branchbase-codex" },
      requestTimeoutMs: 50,
    });
    openAdapters.push(missing);

    await expect(missing.loadAssociatedTasks(worktrees)).rejects.toBeInstanceOf(
      CodexIntegrationUnavailableError
    );
    await expect(
      fakeAdapter("exit", { requestTimeoutMs: 50 }).loadAssociatedTasks(
        worktrees
      )
    ).rejects.toBeInstanceOf(CodexIntegrationUnavailableError);
  });

  it("rejects app-server lines above the configured safety limit", async () => {
    const adapter = new CodexTaskDiscoveryAdapter({
      command: fakeCommand("oversized"),
      maxLineBytes: 256,
    });
    openAdapters.push(adapter);

    await expect(
      adapter.loadAssociatedTasks([{ id: "worktree-a", path: "/canonical/a" }])
    ).rejects.toEqual(
      new CodexIntegrationUnavailableError(
        "Codex response exceeded the safety limit"
      )
    );
  });

  it("bounds the complete paginated refresh", async () => {
    const adapter = new CodexTaskDiscoveryAdapter({
      command: fakeCommand("endless-pages"),
      refreshTimeoutMs: 40,
      requestTimeoutMs: 100,
    });
    openAdapters.push(adapter);

    await expect(
      adapter.loadAssociatedTasks([{ id: "worktree-a", path: "/canonical/a" }])
    ).rejects.toEqual(
      new CodexIntegrationUnavailableError("Codex refresh timed out")
    );
  });

  it("validates candidates and falls back without invoking a shell", async () => {
    const adapter = new CodexTaskDiscoveryAdapter({
      commands: [
        { executable: "/missing/branchbase-codex" },
        fakeCommand("single-page"),
      ],
      now: () => new Date("2026-07-18T15:00:00.000Z"),
      versionTimeoutMs: 100,
    });
    openAdapters.push(adapter);

    await expect(
      adapter.loadAssociatedTasks([
        { id: "worktree-a", path: "/canonical/a" },
        { id: "worktree-b", path: "/canonical/b" },
      ])
    ).resolves.toMatchObject({
      tasks: [{ task: { id: "task-a" } }, { task: { id: "task-b" } }],
    });
  });

  for (const scenario of ["initialize-timeout-once", "partial-eof-once"]) {
    it(`restarts safely after ${scenario}`, async () => {
      const temporary = mkdtempSync(
        pathModule.join(tmpdir(), "branchbase-codex-recovery-")
      );
      try {
        const adapter = new CodexTaskDiscoveryAdapter({
          command: fakeCommand(scenario, {
            BRANCHBASE_FAKE_CODEX_RECOVERY_MARKER: pathModule.join(
              temporary,
              "failed-once"
            ),
          }),
          negativeTtlMs: 0,
          requestTimeoutMs: 2000,
        });
        openAdapters.push(adapter);
        const worktrees = [{ id: "worktree-a", path: "/canonical/a" }];

        await expect(
          adapter.loadAssociatedTasks(worktrees)
        ).rejects.toBeInstanceOf(CodexIntegrationUnavailableError);
        await expect(
          adapter.loadAssociatedTasks(worktrees)
        ).resolves.toMatchObject({
          tasks: [{ task: { id: "task-recovered" } }],
        });
      } finally {
        rmSync(temporary, { force: true, recursive: true });
      }
    });
  }

  localIntegrationIt(
    "accepts sanitized structure from a compatible local Codex app-server",
    async () => {
      const root = realpathSync(process.cwd());
      const adapter = new CodexTaskDiscoveryAdapter();
      openAdapters.push(adapter);

      const snapshot = await adapter.loadAssociatedTasks([
        { id: "local-worktree", path: root },
      ]);
      const safe = snapshot.tasks.every(({ task, worktreePath }) => {
        const keys = Object.keys(task).toSorted();
        return (
          worktreePath === root &&
          JSON.stringify(keys) ===
            JSON.stringify([
              "activity",
              "contextSharedAt",
              "createdAt",
              "id",
              "title",
              "updatedAt",
            ])
        );
      });

      expect(safe).toBe(true);
      expect(Number.isNaN(Date.parse(snapshot.updatedAt))).toBe(false);
    }
  );
});
