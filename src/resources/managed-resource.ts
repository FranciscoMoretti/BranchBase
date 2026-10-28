import { createHash } from "node:crypto";
import { existsSync, statSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "../adapters/persistence/json-file";
import type { AppGroupTarget } from "../app-group/lifecycle";
import type { BranchBaseCommand } from "../configuration/branchbase-command";
import type { BranchBaseConfig } from "../configuration/branchbase-schema";
import { commandWorkingDirectory } from "../configuration/command-directory";
import { ManagedResourceDefinitionSchema } from "../configuration/managed-resource-schema";

const Registry = z.record(
  z.string(),
  z.strictObject({
    approved: z.array(z.string()).optional(),
    path: z.string(),
  })
);

const assertCommandSources = (
  directory: string,
  sourceFiles: string[],
  argv: string[],
  cwd: string
): void => {
  for (const [index, argument] of argv.entries()) {
    if (argument.includes("{")) {
      continue;
    }
    const candidate = path.resolve(cwd, argument);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      continue;
    }
    // Installed executables are supplied by the host; local command files
    // and file arguments belong to the approved resource source manifest.
    if (
      index === 0 &&
      path.isAbsolute(argument) &&
      !candidate.startsWith(`${directory}${path.sep}`)
    ) {
      continue;
    }
    const sourceFile = realpathSync(candidate);
    if (!sourceFile.startsWith(`${directory}${path.sep}`)) {
      throw new Error(
        "Resource command source files must remain inside their execution directory"
      );
    }
    if (!sourceFiles.includes(sourceFile)) {
      throw new Error(
        `Add command source "${argument}" to the resource files manifest before approving it`
      );
    }
  }
};

export const readManagedDefinition = (file: string) => {
  const source = realpathSync(file);
  const definition = ManagedResourceDefinitionSchema.parse(
    JSON.parse(readFileSync(source, "utf-8"))
  );
  const directory = realpathSync(
    path.resolve(path.dirname(source), definition.directory)
  );
  const commands: (BranchBaseCommand | undefined)[] = [
    definition.recipe.start,
    ...(definition.recipe.stop === "process" ? [] : [definition.recipe.stop]),
    definition.build,
    definition.status,
  ];
  const sourceFiles = definition.files.toSorted().map((fileName) => {
    const absolute = realpathSync(path.resolve(directory, fileName));
    if (!absolute.startsWith(`${directory}${path.sep}`)) {
      throw new Error(
        "Resource source files must remain inside their execution directory"
      );
    }
    return absolute;
  });
  const commandDirectories: string[] = [];
  for (const command of commands) {
    if (!command) {
      continue;
    }
    const cwd = commandWorkingDirectory(directory, command.cwd);
    if (command.cwd) {
      commandDirectories.push(cwd);
    }
    for (const name of Object.keys(definition.instances)) {
      assertCommandSources(
        directory,
        sourceFiles,
        command.argv.map((argument) =>
          argument.replaceAll("{instance.name}", name)
        ),
        cwd
      );
    }
  }

  const hash = createHash("sha256")
    .update(JSON.stringify(definition))
    .update(source)
    .update(directory);
  if (commandDirectories.length > 0) {
    hash.update(JSON.stringify(commandDirectories));
  }
  for (const absolute of sourceFiles) {
    hash.update(absolute).update(readFileSync(absolute));
  }
  return {
    definition,
    directory,
    path: source,
    revision: hash.digest("base64url"),
  };
};
export type ManagedDefinition = ReturnType<typeof readManagedDefinition>;

/** Enforce the manifest again after all runtime tokens have been resolved. */
export const assertManagedCommandSources = (
  resource: ManagedDefinition,
  argv: string[],
  cwd: string
): void =>
  assertCommandSources(
    resource.directory,
    resource.definition.files.map((file) =>
      realpathSync(path.resolve(resource.directory, file))
    ),
    argv,
    cwd
  );

/** The authoritative owner and approval are independent of every consumer. */
export class ManagedResourceRegistry {
  private readonly file: string;
  constructor(directory: string) {
    this.file = path.join(directory, "managed-resources.json");
  }
  private read() {
    return Registry.parse(readJsonFile(this.file) ?? {});
  }
  register(file: string, expectedId?: string) {
    const result = readManagedDefinition(file);
    if (expectedId && result.definition.id !== expectedId) {
      throw new Error(
        `Declared resource "${expectedId}" does not match definition ID "${result.definition.id}"`
      );
    }
    const entries = this.read();
    const prior = entries[result.definition.id];
    if (prior && prior.path !== result.path) {
      throw new Error(
        "This resource ID already has an authoritative owner. Choose a distinct ID."
      );
    }
    if (!prior) {
      entries[result.definition.id] = { path: result.path };
      writeJsonFile(this.file, entries);
    }
    return result;
  }
  discover(repoPath: string, config: BranchBaseConfig): string[] {
    const issues: string[] = [];
    for (const [id, declaration] of Object.entries(
      config.managedResources ?? {}
    )) {
      try {
        this.register(path.resolve(repoPath, declaration.file), id);
      } catch (error) {
        issues.push(
          `Cannot load declared resource "${id}" from ${declaration.file}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return issues;
  }
  get(id: string) {
    const entry = this.read()[id];
    if (!entry) {
      throw new Error(`Register managed resource "${id}" first.`);
    }
    const result = readManagedDefinition(entry.path);
    if (result.definition.id !== id) {
      throw new Error("The registered resource identity changed");
    }
    return result;
  }
  approve(id: string, revision: string) {
    const result = this.get(id);
    if (result.revision !== revision) {
      throw new Error(
        "Resource definition changed. Review its current revision before approval."
      );
    }
    const entries = this.read();
    entries[id].approved = [
      ...new Set([...(entries[id].approved ?? []), revision]),
    ];
    writeJsonFile(this.file, entries);
  }
  assertApproved(resource: ManagedDefinition) {
    if (this.get(resource.definition.id).revision !== resource.revision) {
      throw new Error(
        "Resource changed while the operation was waiting. Review it again."
      );
    }
    if (
      !this.read()[resource.definition.id]?.approved?.includes(
        resource.revision
      )
    ) {
      throw new Error(
        `Review and approve resource "${resource.definition.id}" revision ${resource.revision} before running its commands.`
      );
    }
  }
  assertCaptured(captured: { id: string; revision: string; path: string }) {
    const current = this.get(captured.id);
    if (
      current.path !== captured.path ||
      current.revision !== captured.revision
    ) {
      throw new Error(
        "The resource recipe or its source files changed since Start. Restore the captured revision before Stop; the running instance and data have been retained."
      );
    }
    this.assertApproved(current);
    return current;
  }
  list() {
    const entries = this.read();
    return Object.entries(entries).map(([id, entry]) => {
      try {
        const result = this.get(id);
        return {
          approved: entry.approved?.includes(result.revision) ?? false,
          canBuild: Boolean(result.definition.build),
          error: undefined as string | undefined,
          id,
          instances: Object.keys(result.definition.instances),
          name: result.definition.name,
          path: result.path,
          revision: result.revision,
        };
      } catch (error) {
        return {
          approved: false,
          canBuild: false,
          error: error instanceof Error ? error.message : String(error),
          id,
          instances: [],
          name: id,
          path: entry.path,
          revision: "",
        };
      }
    });
  }
  target(id: string, name: string): AppGroupTarget {
    const resource = this.get(id);
    const { definition, directory } = resource;
    const values = definition.instances[name];
    if (!values) {
      throw new Error(`Unknown instance "${name}" of resource "${id}"`);
    }
    const group = {
      ...definition.recipe,
      apps: Object.fromEntries(
        Object.entries(definition.recipe.apps).map(([appId, app]) => [
          appId,
          {
            ...app,
            ...(values.ports[appId] ? { port: values.ports[appId] } : {}),
          },
        ])
      ),
      category: "infrastructure" as const,
      env: { ...definition.recipe.env, ...values.env },
      instances: { mode: "selectable" as const },
      outputs: { ...definition.recipe.outputs, ...values.outputs },
    };
    const config: BranchBaseConfig = {
      appGroups: { resource: group },
      setup: { argv: ["true"] },
      version: 1,
    };
    return {
      config,
      groupId: "resource",
      managed: { ...resource, instanceName: name },
      repoPath: `resource:${id}`,
      worktree: { id: `resource:${id}`, path: directory, routeLabel: name },
    };
  }
}
