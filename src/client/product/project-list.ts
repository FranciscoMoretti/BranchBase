import type { ProjectOverview } from "../../project/catalog-contract";
import { runtimeSummary } from "./runtime-summary";

export const projectIsActive = (project: ProjectOverview): boolean =>
  (project.workspace?.globalRunningCount ?? 0) > 0 ||
  Boolean(
    project.observation?.worktrees.some(
      (worktree) => worktree.services.length > 0
    )
  );
export const projectNeedsAttention = (project: ProjectOverview): boolean =>
  Boolean(
    project.error ||
    project.observation?.warning ||
    project.workspace?.worktrees.some(
      (worktree) =>
        worktree.configuration.error ||
        !worktree.configuration.trusted ||
        worktree.setupState === "failed" ||
        runtimeSummary(worktree).value === "partial"
    )
  );

export type ProjectFilter = "all" | "running" | "stopped" | "attention";
export type ProjectSort = "running" | "name" | "added";

export const selectProjects = (
  projects: ProjectOverview[],
  search: string,
  filter: ProjectFilter,
  sort: ProjectSort
): ProjectOverview[] => {
  const terms = search.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return projects
    .filter((project) => {
      const text = `${project.name} ${project.path}`.toLowerCase();
      const active = projectIsActive(project);
      return (
        terms.every((term) => text.includes(term)) &&
        (filter === "all" ||
          (filter === "running" && active) ||
          (filter === "stopped" &&
            !active &&
            !project.error &&
            Boolean(project.workspace || project.observation)) ||
          (filter === "attention" && projectNeedsAttention(project)))
      );
    })
    .toSorted(
      (a, b) =>
        (sort === "running"
          ? Number(projectIsActive(b)) - Number(projectIsActive(a))
          : 0) ||
        (sort === "added"
          ? Date.parse(b.addedAt) - Date.parse(a.addedAt)
          : 0) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path)
    );
};
