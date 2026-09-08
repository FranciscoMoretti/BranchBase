import { describe, expect, it } from "bun:test";

import { resolveStartCommand } from "./branchbase-config";
import type { BranchBaseConfig } from "./branchbase-schema";

describe("BranchBase App group environment", () => {
  it("renders one dynamically assigned HTTP endpoint into the trusted command", () => {
    const config: BranchBaseConfig = {
      appGroups: {
        web: {
          apps: { site: { protocol: "http", readiness: "tcp" } },
          env: {
            APP_HOST: "{apps.site.host}",
            APP_PORT: "{apps.site.port}",
            APP_URL: "{apps.site.url}",
          },
          instances: { mode: "per-worktree" },
          start: { argv: ["bun", "run", "dev", "--port", "{apps.site.port}"] },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 1,
    };

    expect(
      resolveStartCommand(config, "web", {
        web: {
          apps: {
            site: {
              directUrl: "http://127.0.0.1:43127",
              host: "127.0.0.1",
              port: 43_127,
              url: "http://site.main.example.localhost:1355",
            },
          },
          id: "web",
        },
      })
    ).toEqual({
      argv: ["bun", "run", "dev", "--port", "43127"],
      env: {
        APP_HOST: "127.0.0.1",
        APP_PORT: "43127",
        APP_URL: "http://site.main.example.localhost:1355",
      },
    });
  });

  it("renders another selected instance's stable HTTP endpoint", () => {
    const config: BranchBaseConfig = {
      appGroups: {
        api: {
          apps: { service: { protocol: "http", readiness: "tcp" } },
          instances: { mode: "per-worktree" },
          start: { argv: ["bun", "run", "api"] },
          stop: "process",
        },
        web: {
          apps: { site: { protocol: "http", readiness: "tcp" } },
          env: {
            API_URL: "{appGroups.api.apps.service.url}",
            WEB_PORT: "{apps.site.port}",
          },
          instances: { mode: "per-worktree" },
          start: { argv: ["bun", "run", "web"] },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 1,
    };

    expect(
      resolveStartCommand(config, "web", {
        api: {
          apps: {
            service: {
              directUrl: "http://127.0.0.1:49153",
              host: "127.0.0.1",
              port: 49_153,
              url: "http://service.main.repo.localhost:1355",
            },
          },
          id: "api",
        },
        web: {
          apps: { site: { host: "127.0.0.1", port: 49_152 } },
          id: "web",
        },
      }).env
    ).toEqual({
      API_URL: "http://service.main.repo.localhost:1355",
      WEB_PORT: "49152",
    });
  });
});
