import { expect, test } from "bun:test";

import type { ProjectOverview } from "../../project/catalog-contract";
import { navigationResults } from "./navigation-search";

const project: ProjectOverview = {
  addedAt: "2026-09-20T12:00:00Z",
  error: null,
  name: "BranchBase",
  observation: {
    configured: false,
    repoPath: "/code/branchbase",
    updatedAt: "2026-09-20T12:00:00Z",
    warning: null,
    worktrees: [
      {
        branch: "feature/search",
        id: "search",
        isMain: false,
        path: "/code/branchbase-search",
        services: [],
      },
    ],
  },
  path: "/code/branchbase",
  pins: [],
  workspace: null,
};

test("navigation search matches observed worktrees by branch across repositories", () => {
  const results = navigationResults([project], "  BRANCHBASE search  ");
  expect(results).toHaveLength(1);
  expect(results[0]?.results).toEqual([
    {
      detail: "/code/branchbase-search",
      href: "/?repo=%2Fcode%2Fbranchbase&worktree=search",
      kind: "worktree",
      label: "feature/search",
    },
  ]);
});
test("navigation search keeps same-named repositories separate and supports paths", () => {
  const other = { ...project, observation: null, path: "/other/branchbase" };
  expect(navigationResults([project, other], "")).toHaveLength(2);
  expect(
    navigationResults([project, other], "/other")[0]?.results[0]?.detail
  ).toBe("/other/branchbase");
  expect(navigationResults([project, other], "missing")).toEqual([]);
});
