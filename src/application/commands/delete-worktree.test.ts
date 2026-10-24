import { expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { git, resolveWorktrees } from "../../adapters/git/project-worktrees";
import { ProcessSupervisor } from "../../adapters/host/process-supervisor";
import { FileBranchBaseStateStore } from "../../app-group/assignments";
import { createProjectStatus } from "../../project/status";
import { WorkspaceController } from "../workspace-controller";

test("unconfigured worktrees can be removed without forcing Git or deleting their branch", async () => {
  const sandbox = realpathSync(
    mkdtempSync(path.join(tmpdir(), "branchbase-delete-"))
  );
  const root = path.join(sandbox, "repo");
  const linked = path.join(sandbox, "linked");
  mkdirSync(root);
  git(root, ["init", "-q"]);
  git(root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "Initial",
  ]);
  git(root, ["worktree", "add", "-b", "experiment", linked]);
  const processes = new ProcessSupervisor(path.join(sandbox, "control"));
  const controller = new WorkspaceController(undefined, {
    processes,
    state: new FileBranchBaseStateStore(path.join(sandbox, "state.json")),
  });
  const worktrees = resolveWorktrees(root).map((item, index) => ({
    ...item,
    branch: item.branch ?? "detached",
    isMain: index === 0,
  }));
  const status = createProjectStatus({
    repoPath: root,
    workspace: null,
    worktrees,
  });
  const snapshot = spyOn(controller, "projectStatus").mockReturnValue(status);
  const [, { id }] = worktrees;
  try {
    await expect(
      controller.execute("delete-worktree", {
        repoPath: root,
        worktreeId: worktrees[0].id,
      })
    ).rejects.toThrow("main worktree");
    await expect(
      controller.execute("delete-worktree", {
        repoPath: root,
        worktreeId: "unknown",
      })
    ).rejects.toThrow("Unknown worktree");
    status.issues = [
      { area: "observation", code: "unavailable", message: "Unavailable" },
    ];
    await expect(
      controller.execute("delete-worktree", { repoPath: root, worktreeId: id })
    ).rejects.toThrow("verify running resources");
    status.issues = [];
    const running = spyOn(processes, "listManagedProcesses").mockReturnValue([
      {
        argv: ["bun", "install"],
        cwd: linked,
        label: "Setup",
        ownerId: "setup",
        pid: 123,
        startedAt: new Date().toISOString(),
      },
    ]);
    try {
      await expect(
        controller.execute("delete-worktree", {
          repoPath: root,
          worktreeId: id,
        })
      ).rejects.toThrow("Stop this worktree");
      expect(existsSync(linked)).toBe(true);
    } finally {
      running.mockRestore();
    }
    status.observation = {
      configured: false,
      repoPath: root,
      updatedAt: new Date().toISOString(),
      warning: null,
      worktrees: [
        {
          ...worktrees[1],
          services: [
            {
              address: "127.0.0.1:3000",
              command: "node",
              cwd: linked,
              managed: false,
              pid: 123,
              port: 3000,
              resources: null,
              startedAt: null,
              url: null,
            },
          ],
        },
      ],
    };
    await expect(
      controller.execute("delete-worktree", { repoPath: root, worktreeId: id })
    ).rejects.toThrow("detected services");
    status.observation.worktrees[0].services = [];
    writeFileSync(path.join(linked, "unsaved.txt"), "keep me");
    await expect(
      controller.execute("delete-worktree", { repoPath: root, worktreeId: id })
    ).rejects.toThrow();
    expect(existsSync(path.join(linked, "unsaved.txt"))).toBe(true);
    rmSync(path.join(linked, "unsaved.txt"));
    git(root, ["worktree", "lock", linked]);
    await expect(
      controller.execute("delete-worktree", { repoPath: root, worktreeId: id })
    ).rejects.toThrow();
    git(root, ["worktree", "unlock", linked]);
    await controller.execute("delete-worktree", {
      repoPath: root,
      worktreeId: id,
    });
    expect(existsSync(linked)).toBe(false);
    expect(git(root, ["branch", "--list", "experiment"])).toContain(
      "experiment"
    );
  } finally {
    snapshot.mockRestore();
    await controller.close();
    rmSync(sandbox, { force: true, recursive: true });
  }
});
