import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import pathModule from "node:path";

import { branchbaseJsonSchema } from "./branchbase-json-schema";
import {
  BranchBaseConfigSchema,
  cloneBranchBaseConfig,
} from "./branchbase-schema";
import type { BranchBaseConfig } from "./branchbase-schema";

const validConfig = {
  version: 1,
  setup: { argv: ["bun", "install"] },
  appGroups: {
    development: {
      instances: { mode: "per-worktree" },
      name: "Development",
      start: { argv: ["bun", "run", "dev"] },
      stop: "process",
      env: {
        API_URL: "{apps.api.url}",
        WEB_PORT: "{apps.web.port}",
      },
      apps: {
        api: { protocol: "http", readiness: "tcp" },
        web: {
          protocol: "http",
          readiness: {
            path: "/health",
            statuses: "200-399",
            timeoutSeconds: 60,
            type: "http",
          },
        },
      },
    },
    services: {
      instances: { mode: "selectable" },
      start: { argv: ["docker", "compose", "up", "-d"] },
      stop: { argv: ["docker", "compose", "down"] },
      env: { DATABASE_PORT: "{apps.database.port}" },
      apps: { database: { protocol: "tcp", readiness: "tcp" } },
    },
  },
} satisfies BranchBaseConfig;

describe("shared BranchBase schema", () => {
  it("accepts slot-free Apps with app-group environments", () => {
    const parsed = BranchBaseConfigSchema.parse(validConfig);
    expect(parsed.appGroups.development.env).toEqual({
      API_URL: "{apps.api.url}",
      WEB_PORT: "{apps.web.port}",
    });
    expect(parsed.appGroups.development.apps.web.protocol).toBe("http");
  });

  it("accepts process and command Stop strategies", () => {
    expect(BranchBaseConfigSchema.parse(validConfig)).toEqual({
      ...validConfig,
      appGroups: {
        ...validConfig.appGroups,
        development: {
          ...validConfig.appGroups.development,
          apps: {
            api: validConfig.appGroups.development.apps.api,
            web: {
              ...validConfig.appGroups.development.apps.web,
              readiness: {
                ...validConfig.appGroups.development.apps.web.readiness,
                timeoutSeconds: 60,
              },
            },
          },
        },
      },
    });
  });

  it("requires setup and at least one App group with one App", () => {
    expect(
      BranchBaseConfigSchema.safeParse({ ...validConfig, setup: undefined })
        .success
    ).toBe(false);
    expect(
      BranchBaseConfigSchema.safeParse({ ...validConfig, appGroups: {} })
        .success
    ).toBe(false);
    expect(
      BranchBaseConfigSchema.safeParse({
        ...validConfig,
        appGroups: {
          empty: {
            start: { argv: ["true"] },
            stop: "process",
            apps: {},
          },
        },
      }).success
    ).toBe(false);
  });

  it("rejects invalid references and accepts cross-group instance references", () => {
    const unknown = structuredClone(validConfig);
    unknown.appGroups.development.env.WEB_PORT = "{apps.missing.port}";
    expect(BranchBaseConfigSchema.safeParse(unknown).success).toBe(false);

    const crossGroup = structuredClone(validConfig);
    crossGroup.appGroups.development.env.WEB_PORT =
      "{appGroups.services.apps.database.port}";
    expect(BranchBaseConfigSchema.safeParse(crossGroup).success).toBe(true);
  });

  it("keeps TCP Apps off HTTP readiness", () => {
    const invalid = structuredClone(validConfig);
    invalid.appGroups.services.apps.database.readiness = {
      path: "/",
      statuses: "200-399",
      timeoutSeconds: 60,
      type: "http",
    } as never;
    expect(BranchBaseConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects reversed and out-of-range HTTP status ranges", () => {
    for (const statuses of ["399-200", "099-200", "200-600"]) {
      const invalid = structuredClone(validConfig);
      invalid.appGroups.development.apps.web.readiness.statuses = statuses;
      expect(BranchBaseConfigSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("keeps the published JSON Schema generated from the Zod schema", () => {
    const path = pathModule.join(
      import.meta.dirname,
      "..",
      "..",
      "schema",
      "branchbase.schema.json"
    );
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(
      branchbaseJsonSchema()
    );
  });

  it("publishes defaults as optional JSON Schema inputs", () => {
    const schema = JSON.stringify(branchbaseJsonSchema());
    expect(schema).not.toContain('"required":["protocol","readiness"]');
    expect(schema).not.toContain(
      '"required":["path","statuses","timeoutSeconds","type"]'
    );
  });

  it("clones to an independent configuration value", () => {
    const parsed = BranchBaseConfigSchema.parse(validConfig);
    const clone = cloneBranchBaseConfig(parsed);
    expect(clone).toEqual(parsed);
    expect(clone).not.toBe(parsed);
  });
});
