import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ManagedResourceRegistry } from "./managed-resource";

test.each(["start", "stop"])(
  "approval fingerprints %s scripts relative to their command directory",
  (action) => {
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "resource-approval-"))
    );
    try {
      mkdirSync(path.join(root, "scripts"));
      const script = path.join(root, "scripts", "service.ts");
      writeFileSync(script, "process.exit(0);");
      const files: string[] = [];
      const definition = {
        directory: ".",
        files,
        id: "service",
        idle: "keep-running",
        instances: { default: { outputs: {}, ports: {} } },
        name: "Service",
        recipe: {
          apps: {},
          start: { argv: ["true"] },
          stop: "process",
          [action]: { argv: [process.execPath, "service.ts"], cwd: "scripts" },
        },
        status: { argv: ["true"] },
        version: 1,
      };
      const file = path.join(root, "resource.json");
      const registry = new ManagedResourceRegistry(root);
      writeFileSync(file, JSON.stringify(definition));
      expect(() => registry.register(file)).toThrow("files manifest");
      definition.files = ["scripts/service.ts"];
      writeFileSync(file, JSON.stringify(definition));
      const approved = registry.register(file);
      registry.approve("service", approved.revision);
      registry.assertApproved(approved);
      writeFileSync(script, "process.exit(1);");
      expect(registry.get("service").revision).not.toBe(approved.revision);
      expect(() => registry.assertApproved(approved)).toThrow("changed");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test.each([
  { argument: "../outside.ts", executable: false },
  { argument: "linked.ts", executable: false },
  { argument: "../outside.ts", executable: true },
])(
  "rejects command source outside the owner directory (%j)",
  ({ argument, executable }) => {
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "resource-source-"))
    );
    try {
      const owner = path.join(root, "owner");
      mkdirSync(owner);
      const outside = path.join(root, "outside.ts");
      writeFileSync(outside, "process.exit(0);");
      symlinkSync(outside, path.join(owner, "linked.ts"));
      const file = path.join(owner, "resource.json");
      writeFileSync(
        file,
        JSON.stringify({
          directory: ".",
          files: [],
          id: "service",
          idle: "keep-running",
          instances: { default: { outputs: {}, ports: {} } },
          name: "Service",
          recipe: {
            apps: {},
            start: {
              argv: executable ? [argument] : [process.execPath, argument],
            },
            stop: "process",
          },
          version: 1,
        })
      );
      expect(() => new ManagedResourceRegistry(root).register(file)).toThrow(
        "inside their execution directory"
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);
