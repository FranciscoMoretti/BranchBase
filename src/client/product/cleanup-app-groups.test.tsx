import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectStatus } from "../../project/status-contract";
import { CleanupAppGroups } from "./cleanup-app-groups";

test("cleanup controls remain available without configured status or host observations", () => {
  const status: ProjectStatus = {
    cleanupAppGroups: [],
    configuration: { error: "Invalid configuration", state: "invalid" },
    issues: [
      {
        area: "runtime",
        code: "runtime-unavailable",
        message: "Host unavailable",
      },
    ],
    observation: null,
    repoName: "repo",
    repoPath: "/repo",
    retainedCleanupTargets: [
      {
        groupId: "web",
        instanceId: "retained",
        name: "Web",
        worktreePath: "/repo",
      },
    ],
    updatedAt: "2026-09-12T00:00:00.000Z",
    workspace: null,
    worktrees: [{ branch: "main", id: "main", isMain: true, path: "/repo" }],
  };
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <CleanupAppGroups status={status} />
    </QueryClientProvider>
  );
  expect(markup).toContain("Web");
  expect(markup).toContain("Stop");
  expect(markup).not.toContain("disabled=");
  expect(markup).not.toContain("Stopped");
});
