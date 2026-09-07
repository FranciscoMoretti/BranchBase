import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BranchBaseConfigSchema } from "./branchbase-schema";
import {
  repositoryCommandFingerprint,
  repositoryIsTrusted,
  revokeRepositoryTrust,
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

  it("refuses to overwrite a malformed trust store during revocation", () => {
    const directory = mkdtempSync(join(tmpdir(), "branchbase-trust-"));
    try {
      const file = join(directory, "trusted-repositories.json");
      const contents = JSON.stringify({
        "/code/valid": "retained-fingerprint",
        "/code/invalid": { trusted: true },
      });
      writeFileSync(file, contents);

      expect(() => revokeRepositoryTrust("/code/valid", directory)).toThrow(
        "trust store is invalid"
      );
      expect(readFileSync(file, "utf8")).toBe(contents);
      expect(existsSync(`${file}.write-lock`)).toBe(false);
      expect(
        repositoryIsTrusted("/code/valid", config("per-worktree"), directory)
      ).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("preserves approvals while another writer holds the filesystem lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "branchbase-trust-"));
    const file = join(directory, "trusted-repositories.json");
    const lockDirectory = `${file}.write-lock`;
    const repoPath = "/code/existing";
    const primary = config("per-worktree");
    try {
      trustRepository(repoPath, primary, directory);
      const before = readFileSync(file, "utf8");
      mkdirSync(lockDirectory);
      expect(() => trustRepository("/code/new", primary, directory)).toThrow(
        "retry the approval change"
      );
      expect(() => revokeRepositoryTrust(repoPath, directory)).toThrow(
        lockDirectory
      );
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(existsSync(lockDirectory)).toBe(true);
      rmdirSync(lockDirectory);
      revokeRepositoryTrust(repoPath, directory);
      expect(repositoryIsTrusted(repoPath, primary, directory)).toBe(false);
      expect(existsSync(lockDirectory)).toBe(false);
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
        for (let attempt = 0; ; attempt += 1) {
          try {
            trustRepository(process.env.BRANCHBASE_TEST_REPO!, { setup: { argv: ["true"] }, appGroups: {} }, process.env.BRANCHBASE_TEST_DIR);
            break;
          } catch (error) {
            if (attempt >= 100 || !String(error).includes("retry the approval change")) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
        }
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
      const resultPromise = Promise.all(
        processes.map(async (process) => {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
          ]);
          return { exitCode, stderr, stdout };
        })
      );
      let rejectTimeout: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        rejectTimeout = setTimeout(
          () => reject(new Error("Timed out waiting for trust workers")),
          5000
        );
      });
      let results: Array<{ exitCode: number; stderr: string; stdout: string }>;
      try {
        results = await Promise.race([resultPromise, timeout]);
      } catch (error) {
        for (const process of processes) {
          process.kill();
        }
        await Promise.allSettled(processes.map((process) => process.exited));
        throw error;
      } finally {
        if (rejectTimeout) {
          clearTimeout(rejectTimeout);
        }
      }
      expect(results.every(({ exitCode }) => exitCode === 0)).toBe(true);

      const store = JSON.parse(
        readFileSync(join(directory, "trusted-repositories.json"), "utf8")
      ) as Record<string, unknown>;
      expect(Object.keys(store)).toHaveLength(8);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
