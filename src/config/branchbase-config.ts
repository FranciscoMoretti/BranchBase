import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import pathModule from "node:path";

import { z } from "zod";

import type { BranchBaseCommand } from "./branchbase-command";
import {
  BranchBaseConfigSchema,
  cloneBranchBaseConfig,
} from "./branchbase-schema";
import type { BranchBaseAppGroup, BranchBaseConfig } from "./branchbase-schema";
import { renderBranchBaseTemplate } from "./branchbase-template";
import type { ResolvedTemplateApp } from "./branchbase-template";

// biome-ignore lint/performance/noBarrelFile: preserve the package's internal config-module exports.
export {
  type BranchBaseApp,
  type BranchBaseAppGroup,
  BranchBaseAppGroupNameSchema,
  BranchBaseAppGroupSchema,
  BranchBaseAppIdSchema,
  BranchBaseAppSchema,
  type BranchBaseConfig,
  BranchBaseConfigSchema,
  BranchBaseEnvironmentNameSchema,
  type WorktreeEnvConfig,
} from "./branchbase-schema";

export type ResolvedBranchBaseApp = ResolvedTemplateApp;

export interface ResolvedBranchBaseAppGroup {
  apps: Record<string, ResolvedBranchBaseApp>;
  id: string;
}

export type ResolvedBranchBaseAppGroups = Record<
  string,
  ResolvedBranchBaseAppGroup
>;

export interface ResolvedBranchBaseCommand {
  argv: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface BranchBaseConfigDocument {
  config: BranchBaseConfig;
  revision: string;
}

function group(config: BranchBaseConfig, groupId: string): BranchBaseAppGroup {
  const value = config.appGroups[groupId];
  if (!value) {
    throw new Error(`Unknown App group "${groupId}"`);
  }
  return value;
}

export function branchbaseCommandEnvironment(
  config: BranchBaseConfig,
  groupId: string,
  appGroups: ResolvedBranchBaseAppGroups
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(group(config, groupId).env ?? {}).map(([name, template]) => [
      name,
      renderBranchBaseTemplate(template, {
        appGroups,
        currentGroup: groupId,
      }),
    ])
  );
}

export function findBranchBaseConfig(root: string): string | null {
  const path = pathModule.join(root, ".branchbase.json");
  return existsSync(path) ? path : null;
}

function contentRevision(content: string): string {
  return createHash("sha256").update(content).digest("base64url");
}

export function loadBranchBaseConfigDocument(
  path: string
): BranchBaseConfigDocument {
  const content = readFileSync(path, "utf-8");
  const result = BranchBaseConfigSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    throw new Error(
      `Invalid BranchBase config: ${z.prettifyError(result.error)}`
    );
  }
  return { config: result.data, revision: contentRevision(content) };
}

export function loadBranchBaseConfig(path: string): BranchBaseConfig {
  return loadBranchBaseConfigDocument(path).config;
}

export function updateBranchBaseConfig(
  configPath: string,
  config: BranchBaseConfig,
  expectedRevision: string
): BranchBaseConfigDocument {
  const currentContent = readFileSync(configPath, "utf-8");
  if (contentRevision(currentContent) !== expectedRevision) {
    throw new Error(
      "The configuration changed on disk. Reload it before saving your changes."
    );
  }
  const validated = BranchBaseConfigSchema.parse(cloneBranchBaseConfig(config));
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, { flag: "wx" });
  try {
    renameSync(temporaryPath, configPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return { config: validated, revision: contentRevision(content) };
}

function resolveCommand(
  config: BranchBaseConfig,
  groupId: string,
  command: BranchBaseCommand,
  appGroups: ResolvedBranchBaseAppGroups
): ResolvedBranchBaseCommand {
  const context = { appGroups, currentGroup: groupId };
  return {
    argv: command.argv.map((argument) =>
      renderBranchBaseTemplate(argument, context)
    ),
    ...(command.cwd ? { cwd: command.cwd } : {}),
    env: branchbaseCommandEnvironment(config, groupId, appGroups),
  };
}

export function resolveStartCommand(
  config: BranchBaseConfig,
  groupId: string,
  appGroups: ResolvedBranchBaseAppGroups
): ResolvedBranchBaseCommand {
  return resolveCommand(
    config,
    groupId,
    group(config, groupId).start,
    appGroups
  );
}

export function resolveStopCommand(
  config: BranchBaseConfig,
  groupId: string,
  appGroups: ResolvedBranchBaseAppGroups
): ResolvedBranchBaseCommand | null {
  const stop = group(config, groupId).stop;
  return stop === "process"
    ? null
    : resolveCommand(config, groupId, stop, appGroups);
}

export function resolveSetupCommand(
  config: BranchBaseConfig
): ResolvedBranchBaseCommand {
  return {
    argv: [...config.setup.argv],
    ...(config.setup.cwd ? { cwd: config.setup.cwd } : {}),
    env: {},
  };
}
