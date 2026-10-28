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

test.each(["start", "stop", "build", "status"])(
  "approval validates named-instance scripts for %s",
  (action) => {
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "resource-template-"))
    );
    try {
      mkdirSync(path.join(root, "scripts"));
      writeFileSync(path.join(root, "scripts/first.ts"), "process.exit(0)");
      writeFileSync(path.join(root, "scripts/second.ts"), "process.exit(0)");
      const command = {
        argv: [process.execPath, "scripts/{instance.name}.ts"],
      };
      const definition = {
        directory: ".",
        files: ["scripts/first.ts"],
        id: "service",
        idle: "keep-running",
        instances: {
          first: { outputs: {}, ports: {} },
          second: { outputs: {}, ports: {} },
        },
        name: "Service",
        recipe: {
          apps: {},
          start: { argv: ["true"] },
          stop: "process",
          ...(["start", "stop"].includes(action) ? { [action]: command } : {}),
        },
        status: { argv: ["true"] },
        ...(["build", "status"].includes(action) ? { [action]: command } : {}),
        version: 1,
      };
      const file = path.join(root, "resource.json");
      const registry = new ManagedResourceRegistry(root);
      writeFileSync(file, JSON.stringify(definition));
      expect(() => registry.register(file)).toThrow("files manifest");
      definition.files.push("scripts/second.ts");
      writeFileSync(file, JSON.stringify(definition));
      const approved = registry.register(file);
      registry.approve("service", approved.revision);
      writeFileSync(path.join(root, "scripts/second.ts"), "process.exit(1)");
      expect(() =>
        registry.assertCaptured({ id: "service", ...approved })
      ).toThrow("captured revision");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);

test("instance outputs override recipe defaults without dropping other outputs", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "resource-outputs-"))
  );
  try {
    const file = path.join(root, "resource.json");
    writeFileSync(
      file,
      JSON.stringify({
        directory: ".",
        files: [],
        id: "service",
        idle: "keep-running",
        instances: {
          default: { outputs: { database: "selected" }, ports: {} },
        },
        name: "Service",
        recipe: {
          apps: {},
          outputs: { database: "default", host: "localhost" },
          start: { argv: ["true"] },
          stop: "process",
        },
        version: 1,
      })
    );
    const registry = new ManagedResourceRegistry(root);
    registry.register(file);
    expect(
      registry.target("service", "default").config.appGroups.resource.outputs
    ).toEqual({ database: "selected", host: "localhost" });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

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
