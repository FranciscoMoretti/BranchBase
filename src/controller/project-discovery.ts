import { realpathSync, statSync } from "node:fs";
import pathModule from "node:path";

import { findBranchBaseConfig } from "../config/branchbase-config";
import { DetectedServices } from "../host/detected-services";
import { processTreeUsage } from "../host/process-usage";
import { pathInside } from "../runtime/ports";
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
  private readonly services: Pick<DetectedServices, "inspect" | "webUrl">;
  private readonly scans = new Map<string, Scan>();
  private readonly cwdRoots = new Map<
    string,
    { at: number; root: string | null }
  >();
  private scannedAt = 0;
  private readonly store: ProductStore;
  private readonly worktrees: (path: string) => Worktree[];
  private readonly gitRoot: (path: string) => string;
  private readonly managedPids: () => number[];
  constructor(
    store: ProductStore,
    worktrees: (path: string) => Worktree[],
    gitRoot: (path: string) => string,
    managedPids: () => number[],
    services: Pick<
      DetectedServices,
      "inspect" | "webUrl"
    > = new DetectedServices()
  ) {
    this.services = services;
    this.store = store;
    this.worktrees = worktrees;
    this.gitRoot = gitRoot;
    this.managedPids = managedPids;
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
          this.store.saveProject(root, pathModule.basename(root));
          this.store.append({
            kind: "discovery",
            message: "Project discovered in development folder",
            repoPath: root,
            severity: "info",
          });
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
  private rootFor(cwd: string) {
    const cached = this.cwdRoots.get(cwd);
    if (cached && Date.now() - cached.at < 10_000) {
      return cached.root;
    }
    let root: string | null = null;
    try {
      root = realpathSync(this.gitRoot(cwd));
    } catch {
      /* Unrelated or exiting process. */
    }
    if (this.cwdRoots.size > 512) {
      this.cwdRoots.clear();
    }
    this.cwdRoots.set(cwd, { at: Date.now(), root });
    return root;
  }
  observe(path: string): Observation {
    const worktrees = this.worktrees(path);
    const repoPath = worktrees[0]?.path;
    if (!repoPath) {
      throw new Error("No Git worktrees found.");
    }
    const inspected = this.services.inspect(this.managedPids());
    const result: Observation = {
      configured: findBranchBaseConfig(repoPath) !== null,
      repoPath,
      updatedAt: new Date().toISOString(),
      warning: inspected.warning,
      worktrees: worktrees.map((worktree, index) => ({
        ...worktree,
        branch: worktree.branch ?? "Detached HEAD",
        isMain: index === 0,
        services: inspected.services
          .filter(
            (service) =>
              !service.managed &&
              pathInside(service.cwd, worktree.path) &&
              this.rootFor(service.cwd) === worktree.path
          )
          .map((service) => ({
            ...service,
            url: this.services.webUrl(service),
          })),
      })),
    };
    result.resources = processTreeUsage(
      inspected.samples ?? null,
      result.worktrees.flatMap((worktree) =>
        worktree.services.map((service) => service.pid)
      )
    );
    // A failed inspection must never manufacture service-disappearance events.
    if (!result.warning) {
      this.store.observeDetected(result);
    }
    return result;
  }
}
