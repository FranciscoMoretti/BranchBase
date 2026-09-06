import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchBaseConfigSchema } from "./branchbase-schema";
import {
  repositoryCommandFingerprint,
  repositoryIsTrusted,
  trustRepository,
} from "./repository-trust";

function config(mode: "per-worktree" | "selectable") {
  return BranchBaseConfigSchema.parse({
    version: 1,
    setup: { argv: ["true"] },
    appGroups: {
      Apps: {
        apps: { Web: { protocol: "http" } },
        instances: { mode },
        start: { argv: ["true"] },
        stop: "process",
      },
    },
  });
}

describe("repository trust fingerprint", () => {
  it("fails closed when any persisted trust entry has an invalid shape", () => {
    const directory = mkdtempSync(join(tmpdir(), "branchbase-trust-"));
    try {
      const repoPath = "/code/chat-js";
      writeFileSync(
        join(directory, "trusted-repositories.json"),
        JSON.stringify({
          [repoPath]: repositoryCommandFingerprint(config("per-worktree")),
          "/code/invalid": { trusted: true },
        })
      );

      expect(
        repositoryIsTrusted(repoPath, config("per-worktree"), directory)
      ).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("changes when App-group instance semantics change", () => {
    expect(repositoryCommandFingerprint(config("per-worktree"))).not.toBe(
      repositoryCommandFingerprint(config("selectable"))
    );
  });

  it("retains approvals for multiple effective configurations in one Project", () => {
    const directory = mkdtempSync(join(tmpdir(), "branchbase-trust-"));
    try {
      const repoPath = "/code/chat-js";
      const primary = config("per-worktree");
      const experiment = config("selectable");

      trustRepository(repoPath, primary, directory);
      trustRepository(repoPath, experiment, directory);

      expect(repositoryIsTrusted(repoPath, primary, directory)).toBe(true);
      expect(repositoryIsTrusted(repoPath, experiment, directory)).toBe(true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("serializes concurrent updates from separate processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "branchbase-trust-"));
    try {
      const modulePath = join(process.cwd(), "src/config/repository-trust.ts");
      const child = `
        import { trustRepository } from ${JSON.stringify(modulePath)};
        trustRepository(process.env.BRANCHBASE_TEST_REPO!, { setup: { argv: ["true"] }, appGroups: {} }, process.env.BRANCHBASE_TEST_DIR);
      `;
      const processes = Array.from({ length: 8 }, (_, index) =>
        // biome-ignore lint/correctness/noUndeclaredVariables: Bun is the test runtime.
        Bun.spawn(["bun", "-e", child], {
          env: {
            ...process.env,
            BRANCHBASE_TEST_DIR: directory,
            BRANCHBASE_TEST_REPO: `/code/concurrent-${index}`,
          },
          stdout: "ignore",
          stderr: "pipe",
        })
      );
      const results = await Promise.all(
        processes.map((process) => process.exited)
      );
      expect(results.every((exitCode) => exitCode === 0)).toBe(true);

      const store = JSON.parse(
        readFileSync(join(directory, "trusted-repositories.json"), "utf8")
      ) as Record<string, unknown>;
      expect(Object.keys(store)).toHaveLength(8);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
