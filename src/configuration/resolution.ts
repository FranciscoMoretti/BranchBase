import path from "node:path";

import {
  findBranchBaseConfig,
  loadBranchBaseConfigDocument,
} from "./branchbase-config";
import type { BranchBaseConfigDocument } from "./branchbase-config";
import type { WorktreeConfigSource } from "./worktree-config-source";

export interface ProjectConfiguration {
  document: BranchBaseConfigDocument;
  path: string;
}

export interface WorktreeConfiguration extends ProjectConfiguration {
  error: string | null;
  preference: WorktreeConfigSource;
  source: WorktreeConfigSource;
}

export const resolveProjectConfiguration = (
  projectRoot: string
): ProjectConfiguration | null => {
  const configPath = findBranchBaseConfig(projectRoot);
  return configPath
    ? { document: loadBranchBaseConfigDocument(configPath), path: configPath }
    : null;
};

export const resolveWorktreeConfiguration = (
  project: ProjectConfiguration,
  worktreePath: string,
  preference: WorktreeConfigSource
): WorktreeConfiguration => {
  if (preference !== "checkout") {
    return {
      document: project.document,
      error: null,
      path: project.path,
      preference,
      source: "project-default",
    };
  }
  const checkoutPath = findBranchBaseConfig(worktreePath);
  if (!checkoutPath) {
    return {
      document: project.document,
      error: `Missing checkout configuration: ${path.join(worktreePath, ".branchbase.json")}`,
      path: project.path,
      preference,
      source: "project-default",
    };
  }
  try {
    return {
      document: loadBranchBaseConfigDocument(checkoutPath),
      error: null,
      path: checkoutPath,
      preference,
      source: "checkout",
    };
  } catch (error) {
    return {
      document: project.document,
      error: `Invalid checkout configuration: ${error instanceof Error ? error.message : String(error)}`,
      path: project.path,
      preference,
      source: "project-default",
    };
  }
};
