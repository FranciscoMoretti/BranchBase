import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { findBranchBaseConfig } from "../config/branchbase-config";
import type { Observation } from "./discovery-contract";
import { scanRepositories } from "./folder-discovery";
import type { ProductStore } from "./product-store";

interface Worktree {
  branch: string | null;
  id: string;
  path: string;
}
interface Scan {
  lastScannedAt: string | null;
  projectsFound: number;
  warning: string | null;
}
/** Discovery has no command execution or lifecycle authority. */
export class ProjectDiscovery {
  private readonly scans = new Map<string, Scan>();
  private scannedAt = 0;
  private readonly store: ProductStore;
  private readonly worktrees: (path: string) => Worktree[];
  constructor(store: ProductStore, worktrees: (path: string) => Worktree[]) {
    this.store = store;
    this.worktrees = worktrees;
  }

  addFolder(path: string) {
    let canonical: string;
    try {
      canonical = realpathSync(path);
      if (!statSync(canonical).isDirectory()) {
        throw new Error("Choose a development folder.");
      }
    } catch {
      throw new Error("Choose a development folder.");
    }
    this.store.saveFolder(canonical);
    this.scan(true);
  }
  removeFolder(path: string) {
    let key = path;
    try {
      key = realpathSync(path);
    } catch {
      // Preserve the exact missing path so it can be removed from persisted metadata.
    }
    this.store.removeFolder(key);
    this.scans.delete(key);
  }
  folders() {
    this.scan();
    return this.store.folders().map((folder) => ({
      ...folder,
      ...(this.scans.get(folder.path) ?? {
        lastScannedAt: null,
        projectsFound: 0,
        warning: null,
      }),
    }));
  }
  scan(force = false) {
    if (!force && Date.now() - this.scannedAt < 30_000) {
      return;
    }
    this.scannedAt = Date.now();
    for (const folder of this.store.folders()) {
      this.scanFolder(folder.path);
    }
  }
  private scanFolder(path: string) {
    let warning: string | null = null;
    const roots = new Set<string>();
    try {
      const scan = scanRepositories(path);
      warning = scan.warning;
      if (scan.repositories.length > 100) {
        warning =
          "Showing the first 100 repositories in this folder. Add more specific folders to discover the rest.";
      }
      for (const candidate of scan.repositories.slice(0, 100)) {
        try {
          const root = this.worktrees(candidate)[0]?.path;
          if (root) {
            roots.add(root);
          }
        } catch {
          warning =
            "Some repositories could not be inspected. They may have moved or become unavailable.";
        }
      }
      const saved = new Set(
        this.store.projects().map((project) => project.path)
      );
      const excluded = new Set(this.store.excludedPaths());
      for (const root of roots) {
        if (!(saved.has(root) || excluded.has(root))) {
          this.store.saveProject(root, basename(root));
        }
      }
    } catch {
      warning =
        "Folder unavailable. Check that it still exists and BranchBase can read it.";
    }
    this.scans.set(path, {
      lastScannedAt: new Date().toISOString(),
      projectsFound: roots.size,
      warning,
    });
  }
  observe(path: string): Observation {
    const worktrees = this.worktrees(path);
    const repoPath = worktrees[0]?.path;
    if (!repoPath) {
      throw new Error("No Git worktrees found.");
    }
    const result: Observation = {
      repoPath,
      configured: findBranchBaseConfig(repoPath) !== null,
      updatedAt: new Date().toISOString(),
      warning: null,
      worktrees: worktrees.map((worktree, index) => ({
        ...worktree,
        branch: worktree.branch ?? "Detached HEAD",
        isMain: index === 0,
      })),
    };
    return result;
  }
}
