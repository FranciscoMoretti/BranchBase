import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import pathModule from "node:path";

import { CODEX_HOOK_EVENTS } from "./codex-hook-activity";

const PLUGIN_ROOT = pathModule.join(
  import.meta.dir,
  "..",
  "..",
  "plugins",
  "branchbase"
);

describe("BranchBase Codex plugin", () => {
  it("uses default hook discovery with one fixed fail-open command per event", () => {
    const manifest = JSON.parse(
      readFileSync(
        pathModule.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"),
        "utf-8"
      )
    );
    const configuration = JSON.parse(
      readFileSync(pathModule.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf-8")
    );

    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest).not.toHaveProperty("skills");
    expect(Object.keys(configuration.hooks).toSorted()).toEqual(
      [...CODEX_HOOK_EVENTS].toSorted()
    );
    for (const event of CODEX_HOOK_EVENTS) {
      const groups = configuration.hooks[event];
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks).toEqual([
        {
          command: `"\${PLUGIN_ROOT}/hooks/branchbase-hook" ${event}`,
          timeout: 2,
          type: "command",
        },
      ]);
    }
    expect(
      statSync(pathModule.join(PLUGIN_ROOT, "hooks", "branchbase-hook")).mode %
        0o1000
    ).toBeGreaterThanOrEqual(0o100);
  });
});
