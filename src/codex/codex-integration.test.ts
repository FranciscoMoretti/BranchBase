import { describe, expect, it } from "bun:test";

import {
  CodexIntegrationUnavailableError,
  createUnavailableCodexIntegrationAdapter,
  FakeCodexIntegrationAdapter,
  projectCodexIntegration,
} from "./codex-integration";

describe("Codex integration projection", () => {
  it("covers every worktree and orders all associated tasks deterministically", () => {
    const projection = projectCodexIntegration(
      [
        { id: "worktree-a", path: "/repo/a" },
        { id: "worktree-b", path: "/repo/b" },
      ],
      {
        tasks: [
          {
            task: {
              activity: null,
              contextSharedAt: null,
              createdAt: "2026-07-17T10:00:00.000Z",
              id: "task-z",
              title: "Later alphabetically",
              updatedAt: "2026-07-18T10:00:00.000Z",
            },
            worktreePath: "/repo/a",
          },
          {
            task: {
              activity: null,
              contextSharedAt: null,
              createdAt: "2026-07-16T10:00:00.000Z",
              id: "task-a",
              title: "Earlier alphabetically",
              updatedAt: "2026-07-18T10:00:00.000Z",
            },
            worktreePath: "/repo/a",
          },
          {
            task: {
              activity: null,
              contextSharedAt: null,
              createdAt: "2026-07-15T10:00:00.000Z",
              id: "task-newest",
              title: "Newest",
              updatedAt: "2026-07-18T11:00:00.000Z",
            },
            worktreePath: "/repo/a",
          },
        ],
        updatedAt: "2026-07-18T12:00:00.000Z",
      }
    );

    expect(projection.updatedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(Object.keys(projection.worktrees)).toEqual([
      "worktree-a",
      "worktree-b",
    ]);
    expect(
      projection.worktrees["worktree-a"].tasks.map((task) => task.id)
    ).toEqual(["task-newest", "task-a", "task-z"]);
    expect(projection.worktrees["worktree-b"]).toEqual({ tasks: [] });
  });

  it("provides deterministic fake and unavailable adapters at the same seam", async () => {
    const adapterSnapshot = {
      tasks: [],
      updatedAt: "2026-07-18T12:00:00.000Z",
    };
    const worktrees = [{ id: "worktree-a", path: "/repo/a" }];
    const fake = new FakeCodexIntegrationAdapter(adapterSnapshot);

    expect(await fake.loadAssociatedTasks(worktrees)).toEqual(adapterSnapshot);
    expect(fake.requests).toEqual([worktrees]);
    await expect(
      createUnavailableCodexIntegrationAdapter().loadAssociatedTasks(worktrees)
    ).rejects.toBeInstanceOf(CodexIntegrationUnavailableError);
  });
});
