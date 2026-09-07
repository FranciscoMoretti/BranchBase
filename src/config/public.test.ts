import { describe, expect, it } from "bun:test";

import { resolveStartCommand } from "branchbase/config";
import type {
  BranchBaseConfig,
  ResolvedBranchBaseAppGroups,
} from "branchbase/config";

describe("public config contract", () => {
  it("resolves slot-free app endpoints through the package subpath", () => {
    const config: BranchBaseConfig = {
      version: 1,
      setup: { argv: ["bun", "install"] },
      appGroups: {
        Apps: {
          instances: { mode: "per-worktree" },
          start: {
            argv: ["bun", "run", "dev", "--url", "{apps.web.url}"],
          },
          stop: "process",
          env: { APP_URL: "{apps.web.url}" },
          apps: { web: { protocol: "http", readiness: "tcp" } },
        },
      },
    };
    const appGroups: ResolvedBranchBaseAppGroups = {
      Apps: {
        id: "Apps",
        apps: {
          web: {
            directUrl: "http://127.0.0.1:49152",
            host: "127.0.0.1",
            port: 49_152,
            url: "http://web.main.repo.localhost:1355",
          },
        },
      },
    };

    expect(resolveStartCommand(config, "Apps", appGroups)).toEqual({
      argv: [
        "bun",
        "run",
        "dev",
        "--url",
        "http://web.main.repo.localhost:1355",
      ],
      env: { APP_URL: "http://web.main.repo.localhost:1355" },
    });
  });
});
