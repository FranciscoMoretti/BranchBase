import { expect, test } from "bun:test";

import type { ProjectOverview } from "../../project/catalog-contract";
import { selectProjects } from "./project-list";
import { worktree } from "./test-fixtures";

const project = (name: string, addedAt: string): ProjectOverview => ({
  addedAt,
  error: null,
  name,
  observation: {
    configured: false,
    repoPath: `/code/${name}`,
    updatedAt: addedAt,
    warning: null,
    worktrees: [{ ...worktree, services: [] }],
  },
  path: `/code/${name}`,
  pins: [],
  workspace: null,
});
const alpha = project("Alpha", "2026-09-01T00:00:00Z");
const beta = {
  ...project("Beta", "2026-09-02T00:00:00Z"),
  lastStartedAt: "2026-09-03T00:00:00Z",
};
const broken = {
  ...project("Broken", "2026-09-03T00:00:00Z"),
  error: "Inspection failed",
  observation: null,
};

test("search combines trimmed case-insensitive name and path terms with filters", () => {
  expect(
    selectProjects([alpha, beta, broken], " CODE  ALPHA ", "stopped", "name")
  ).toEqual([alpha]);
  expect(selectProjects([broken], "", "stopped", "name")).toEqual([]);
  expect(selectProjects([alpha, broken], "", "attention", "name")).toEqual([
    broken,
  ]);
});
test("sort supports name and last start without changing the catalog", () => {
  const projects = [beta, alpha];
  expect(selectProjects(projects, "", "all", "name")).toEqual([alpha, beta]);
  expect(selectProjects(projects, "", "all", "started")).toEqual([beta, alpha]);
  expect(projects).toEqual([beta, alpha]);
});
test("detected services count as running for filtering and ordering", () => {
  const running = {
    ...project("Zeta", alpha.addedAt),
    lastStartedAt: "2026-09-04T00:00:00Z",
  };
  if (!running.observation) {
    throw new Error("Missing fixture observation");
  }
  running.observation.worktrees[0].services = [
    {
      address: "127.0.0.1:3000",
      command: "bun server.ts",
      cwd: running.path,
      managed: false,
      pid: 42,
      port: 3000,
      resources: null,
      startedAt: null,
      url: "http://127.0.0.1:3000",
    },
  ];
  expect(selectProjects([alpha, running], "", "all", "started")).toEqual([
    running,
    alpha,
  ]);
  expect(selectProjects([alpha, running], "", "running", "name")).toEqual([
    running,
  ]);
});
