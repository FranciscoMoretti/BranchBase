import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import pathModule from "node:path";

import {
  initializeRepository,
  planRepositoryInitialization,
} from "./repository-initializer";

describe("repository initialization", () => {
  it("detects commands and creates a slot-free HTTP App", () => {
    const root = mkdtempSync(
      pathModule.join(tmpdir(), "branchbase-initialize-")
    );
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(
        pathModule.join(root, "package.json"),
        JSON.stringify({
          packageManager: "bun@1.3.0",
          scripts: { dev: "vite" },
        })
      );
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedRuntime).toBe("Node.js");
      expect(preview.config.version).toBe(1);
      expect(preview.config.setup.argv).toEqual(["bun", "install"]);
      expect(preview.config.appGroups.Apps.start.argv).toEqual([
        "bun",
        "run",
        "dev",
      ]);
      expect(preview.config.appGroups.Apps.apps.App).toEqual({
        protocol: "http",
        readiness: "tcp",
      });
      expect(preview.config.appGroups.Apps.env).toEqual({
        PORT: "{apps.App.port}",
      });
      expect(() => readFileSync(preview.configPath)).toThrow();

      const created = initializeRepository(root);
      expect(JSON.parse(readFileSync(created.configPath, "utf-8"))).toEqual(
        created.config
      );
      expect(() => initializeRepository(root)).toThrow("already exists");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not present fallback commands as detected commands", () => {
    const root = mkdtempSync(pathModule.join(tmpdir(), "branchbase-django-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(pathModule.join(root, "manage.py"), "");
      const preview = planRepositoryInitialization(root);
      expect(preview.detectedSetupCommand).toBeNull();
      expect(preview.detectedStartCommand).toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("uses the same App group start field for Docker Compose", () => {
    const root = mkdtempSync(pathModule.join(tmpdir(), "branchbase-compose-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: root });
      writeFileSync(pathModule.join(root, "compose.yaml"), "services: {}\n");
      expect(
        planRepositoryInitialization(root).config.appGroups.Apps.start.argv
      ).toEqual(["docker", "compose", "up"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
