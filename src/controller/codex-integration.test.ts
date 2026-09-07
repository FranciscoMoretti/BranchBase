import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import { FakeCodexIntegrationAdapter } from "../codex/codex-integration";
import { FileBranchBaseStateStore } from "../runtime/local-state";
import { WorkspaceController } from "./workspace-controller";

describe("WorkspaceController Codex projection", () => {
  it("loads Codex data asynchronously for the synchronously inspected worktrees", async () => {
    const root = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-codex-projection-")
    );
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        pathModule.join(root, ".branchbase.json"),
        JSON.stringify({
          appGroups: {
            App: {
              apps: { Web: { protocol: "http", readiness: "tcp" } },
              start: { argv: ["true"] },
              stop: "process",
            },
          },
          setup: { argv: ["true"] },
          version: 1,
        })
      );
      const task = {
        activity: {
          observedAt: "2026-07-18T12:30:00.000Z",
          state: "working" as const,
          subagentCount: 2,
        },
        contextSharedAt: "2026-07-18T12:15:00.000Z",
        createdAt: "2026-07-17T10:00:00.000Z",
        id: "task-a",
        title: "Projection seam",
        updatedAt: "2026-07-18T12:00:00.000Z",
      };
      const canonicalRoot = realpathSync(root);
      const fake = new FakeCodexIntegrationAdapter({
        tasks: [{ task, worktreePath: canonicalRoot }],
        updatedAt: "2026-07-18T13:00:00.000Z",
      });
      const controller = new WorkspaceController(fake, {
        state: new FileBranchBaseStateStore(
          pathModule.join(root, "state.json")
        ),
      });

      const workspace = controller.inspect(root);
      const projection = await controller.inspectCodex(root);
      const worktreeId = workspace.worktrees[0].id;

      expect(fake.requests).toEqual([
        [{ id: worktreeId, path: canonicalRoot }],
      ]);
      expect(projection).toEqual({
        updatedAt: "2026-07-18T13:00:00.000Z",
        worktrees: { [worktreeId]: { tasks: [task] } },
      });
      expect(workspace).not.toHaveProperty("codex");
      await controller.close();
      expect(fake.closed).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
