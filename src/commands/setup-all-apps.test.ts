import { describe, expect, it } from "bun:test";

import type { WorkspaceController } from "../controller/workspace-controller";
import { setupAllApps } from "./setup-all-apps";

function controllerFixture(input: {
  onAssert: (worktreeId?: string) => void;
  onStart: (worktreeId: string) => void;
}): WorkspaceController {
  return {
    assertTrusted: (_repoPath: string, worktreeId?: string) =>
      input.onAssert(worktreeId),
    inspect: () => ({ worktrees: [{ id: "main" }, { id: "feature" }] }),
    startSetup: (_repoPath: string, worktreeId: string) =>
      input.onStart(worktreeId),
  } as unknown as WorkspaceController;
}

describe("setup all apps", () => {
  it("validates every target before starting any setup", () => {
    const started: string[] = [];
    const controller = controllerFixture({
      onAssert: (worktreeId) => {
        if (worktreeId === "feature") {
          throw new Error("untrusted feature");
        }
      },
      onStart: (worktreeId) => started.push(worktreeId),
    });

    expect(() =>
      setupAllApps(controller, {
        repoPath: "/repo",
        worktreeIds: ["main", "feature"],
      })
    ).toThrow("untrusted feature");
    expect(started).toEqual([]);
  });

  it("still validates repository trust when no worktrees are selected", () => {
    const approvals: (string | undefined)[] = [];
    const controller = controllerFixture({
      onAssert: (worktreeId) => approvals.push(worktreeId),
      onStart: () => undefined,
    });

    setupAllApps(controller, { repoPath: "/repo", worktreeIds: [] });

    expect(approvals).toEqual([undefined]);
  });
});
