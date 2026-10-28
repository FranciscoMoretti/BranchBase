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
  appGroups: {
    development: {
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
      env: {
        API_URL: "{apps.api.url}",
        WEB_PORT: "{apps.web.port}",
      },
      instances: { mode: "per-worktree" },
      name: "Development",
      start: { argv: ["bun", "run", "dev"] },
      stop: "process",
    },
    services: {
      apps: { database: { protocol: "tcp", readiness: "tcp" } },
      env: { DATABASE_PORT: "{apps.database.port}" },
      instances: { mode: "selectable" },
      start: { argv: ["docker", "compose", "up", "-d"] },
      stop: { argv: ["docker", "compose", "down"] },
    },
  },
  setup: { argv: ["bun", "install"] },
  version: 1,
} satisfies BranchBaseConfig;

describe("shared BranchBase schema", () => {
  it("reports invalid output templates at the configuration field", () => {
    const config = cloneBranchBaseConfig(validConfig);
    config.appGroups.services.outputs = { host: "{apps.databse.host}" };
    const parsed = BranchBaseConfigSchema.safeParse(config);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual([
        "appGroups",
        "services",
        "outputs",
        "host",
      ]);
    }
    config.appGroups.services.outputs = { host: "{apps.database.host}" };
    expect(BranchBaseConfigSchema.safeParse(config).success).toBe(true);
  });
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

  it("requires setup and groups; allows workers without endpoints", () => {
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
            apps: {},
            start: { argv: ["true"] },
            stop: "process",
          },
        },
      }).success
    ).toBe(true);
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

it("accepts direct URL templates for HTTP endpoints with configured fixed ports", () => {
  const config = structuredClone(validConfig);
  const parsed = BranchBaseConfigSchema.parse({
    ...config,
    appGroups: {
      ...config.appGroups,
      development: {
        ...config.appGroups.development,
        apps: { api: { port: 8000, protocol: "http" } },
        env: { API_PORT: "{apps.api.port}", API_URL: "{apps.api.directUrl}" },
      },
    },
  });
  expect(parsed.appGroups.development.apps.api.port).toBe(8000);
});
