import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import pathModule from "node:path";

const EXCLUDED = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "coverage",
  "Pods",
]);
/**
 * Bounded directory discovery from an explicitly selected root, canonicalized
 * before traversal. Nested symlinks are skipped and repository commands are
 * never executed.
 */
export const scanRepositories = (root: string, maxDepth = 3, limit = 2000) => {
  const canonical = realpathSync(root);
  if (!statSync(canonical).isDirectory()) {
    throw new Error("Choose a development folder.");
  }
  const queue = [{ depth: 0, path: canonical }];
  const repositories: string[] = [];
  let visited = 0;
  let unreadable = 0;
  while (queue.length && visited < limit) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    visited++;
    if (existsSync(pathModule.join(current.path, ".git"))) {
      repositories.push(current.path);
      continue;
    }
    if (current.depth >= maxDepth) {
      continue;
    }
    try {
      for (const entry of readdirSync(current.path, {
        withFileTypes: true,
      }).toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !EXCLUDED.has(entry.name)
        ) {
          queue.push({
            depth: current.depth + 1,
            path: pathModule.join(current.path, entry.name),
          });
        }
      }
    } catch {
      unreadable++;
    }
  }
  let warning: string | null = null;
  if (unreadable) {
    warning = `${unreadable} folders could not be read.`;
  }
  if (queue.length) {
    const limitWarning = `Scan limited to ${limit} folders. Add a more specific folder to discover the rest.`;
    warning = [warning, limitWarning].filter(Boolean).join(" ") || null;
  }
  return { repositories, warning };
};
