import type { ProjectOverview } from "../../project/catalog-contract";
import { hrefFor } from "./data";

export interface NavigationResult {
  href: string;
  label: string;
  detail: string;
  kind: "repository" | "worktree";
}
export interface NavigationResultGroup {
  name: string;
  path: string;
  results: NavigationResult[];
}

export const navigationResults = (
  projects: ProjectOverview[],
  query: string
): NavigationResultGroup[] => {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = (...values: string[]) => {
    const text = values.join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  };
  return projects.flatMap((project) => {
    const results: NavigationResult[] = [];
    if (matches(project.name, project.path)) {
      results.push({
        detail: project.path,
        href: hrefFor({ repo: project.path }),
        kind: "repository",
        label: project.name,
      });
    }
    const worktrees =
      project.workspace?.worktrees ?? project.observation?.worktrees ?? [];
    for (const worktree of worktrees) {
      if (matches(project.name, project.path, worktree.branch, worktree.path)) {
        results.push({
          detail: worktree.path,
          href: hrefFor({ repo: project.path, worktree: worktree.id }),
          kind: "worktree",
          label: worktree.branch,
        });
      }
    }
    return results.length
      ? [{ name: project.name, path: project.path, results }]
      : [];
  });
};
