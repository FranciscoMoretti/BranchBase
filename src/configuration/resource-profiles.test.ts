import { describe, expect, it } from "bun:test";

import { BranchBaseConfigSchema } from "./branchbase-schema";
import { repositoryCommandFingerprint } from "./repository-trust";
import {
  branchMatches,
  defaultResourceProfiles,
  dependencyOrder,
  resolveResourceProfile,
} from "./resource-profiles";

const configuration = () => {
  const config = BranchBaseConfigSchema.parse({
    appGroups: {
      app: { apps: {}, start: { argv: ["worker"] }, stop: "process" },
      database: {
        apps: { db: { protocol: "tcp" } },
        category: "infrastructure",
        start: { argv: ["database"] },
        stop: "process",
      },
    },
    setup: { argv: ["true"] },
    version: 1,
  });
  const profiles = defaultResourceProfiles(config);
  profiles.rules = [{ branch: "feature/*", profile: "isolated" }];
  return { ...config, profiles };
};

describe("resource profile configuration", () => {
  it("resolves override, ordered branch rule, then project default", () => {
    const config = configuration();
    expect(resolveResourceProfile(config, "main")).toMatchObject({
      connections: { database: { policy: "project" } },
      id: "shared",
      source: "default",
    });
    expect(resolveResourceProfile(config, "feature/api")).toMatchObject({
      id: "isolated",
      source: "branch",
    });
    expect(
      resolveResourceProfile(config, "feature/api", "shared")
    ).toMatchObject({ id: "shared", source: "override" });
    expect(resolveResourceProfile(config, "feature/api", null)?.id).toBe(
      "isolated"
    );
  });
  it("anchors exact branches and treats only stars as wildcards", () => {
    for (const [pattern, branch, matches] of [
      ["main", "mainmain", false],
      ["main", "main", true],
      ["feature/*", "feature/api", true],
      ["feature/*", "other/feature/api", false],
      ["*release*fix", "release/x/fix", true],
      ["a*a", "a", false],
      ["*", "main", true],
      ["fix.[x]", "fix.[x]", true],
    ] as const) {
      expect(branchMatches(pattern, branch)).toBe(matches);
    }
  });
  it("validates profile references and dependency cycles", () => {
    const config = configuration();
    config.profiles.default = "missing";
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
    config.profiles.default = "shared";
    config.profiles.definitions.shared.connections.app = { policy: "project" };
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
    config.profiles.definitions.shared.connections = {};
    config.appGroups.database.dependsOn = ["app"];
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
    config.appGroups.database.dependsOn = ["missing"];
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
  });
  it("rejects a shared resource depending on a worktree-specific service", () => {
    const config = configuration();
    config.appGroups.app.dependsOn = [];
    config.appGroups.database.dependsOn = ["app"];
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
    config.appGroups.app.category = "infrastructure";
    config.profiles.definitions.shared.connections.app = { policy: "worktree" };
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(false);
    config.profiles.definitions.shared.connections.app = { policy: "project" };
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(true);
  });
  it("starts infrastructure before consumers and supports explicit opt-out", () => {
    const config = configuration();
    expect(dependencyOrder(config, "app")).toEqual(["database", "app"]);
    config.appGroups.app.dependsOn = [];
    expect(dependencyOrder(config, "app")).toEqual(["app"]);
  });
  it("requires new command approval when connection or dependency policy changes", () => {
    const config = configuration();
    const previous = repositoryCommandFingerprint(config);
    config.profiles.definitions.shared.connections.database = {
      policy: "existing",
      resource: "local-db",
    };
    expect(repositoryCommandFingerprint(config)).not.toBe(previous);
    const connected = repositoryCommandFingerprint(config);
    config.appGroups.database.category = "application";
    expect(repositoryCommandFingerprint(config)).not.toBe(connected);
  });
});
