import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { AppGroupSnapshot } from "../../controller/workspace-snapshot";
import {
  CodexTasksSection,
  WorktreeConfigurationSource,
} from "../components/worktree-details";
import { EnvironmentList } from "./environment-list";
import type { GroupControls } from "./environment-list";
import { GroupDetails } from "./group-details";
import { worktree } from "./test-fixtures";

const noop = () => undefined;
const controls: GroupControls = {
  review: noop,
  blocked: () => false,
  inspect: noop,
  restart: noop,
  retry: noop,
  toggle: noop,
};
function group(id: string): AppGroupSnapshot {
  return {
    id,
    name: id,
    health: "partially-running",
    apps: worktree.apps,
    processRunning: true,
    instance: { id: `${id}-instance`, name: "main", mode: "per-worktree" },
    instances: [],
    stop: "process",
  };
}
function list(groups: AppGroupSnapshot[], expanded = false) {
  return renderToStaticMarkup(
    <EnvironmentList
      codexError={false}
      commandActions={{
        onRestart: noop,
        onSetup: noop,
        onStart: noop,
        onStop: noop,
      }}
      controls={controls}
      expandedIds={expanded ? [worktree.id] : []}
      onDelete={noop}
      onExpand={noop}
      worktrees={[{ ...worktree, appGroups: groups }]}
    />
  );
}
test("collapsed worktrees expose scoped controls and ready links while retaining overflow failures", () => {
  const markup = list([group("Product"), group("Docs"), group("Services")]);
  expect(markup).toContain('aria-label="Stop Product in main"');
  expect(markup).toContain('aria-label="Stop Docs in main"');
  expect(markup).not.toContain('aria-label="Stop Services in main"');
  expect(markup).toContain("Additional groups need attention");
  expect(markup).toContain('href="http://chat.project.repo.localhost:1355"');
  expect(markup).not.toContain('href="http://127.0.0.1:3002"');
});
test("expansion exposes every group without introducing worktree-wide lifecycle controls", () => {
  const markup = list(
    [group("Product"), group("Docs"), group("Services")],
    true
  );
  expect(markup).toContain('aria-label="Stop Services in main"');
  expect(markup).toContain('aria-expanded="true"');
  expect(markup).not.toContain(">Start all<");
});
test("group details keep readiness separate from routing and use a managed log viewport", () => {
  const selected = group("Product");
  selected.apps = [
    { ...worktree.apps[0], open: false, routeState: "conflict" },
  ];
  const client = new QueryClient();
  client.setQueryData(
    ["logs", "/tmp/project", worktree.id, selected.id],
    ["Server ready"]
  );
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GroupDetails
        codexError={false}
        controls={controls}
        group={selected}
        onBack={noop}
        onClearLogs={noop}
        onConfigSource={noop}
        onCreateInstance={async () => undefined}
        onSelectInstance={noop}
        onTabChange={noop}
        repoPath="/tmp/project"
        tab="logs"
        worktree={worktree}
      />
    </QueryClientProvider>
  );
  expect(markup).toContain("Ready");
  expect(markup).toContain("Route conflict");
  expect(markup).not.toContain(
    'href="http://chat.project.repo.localhost:1355"'
  );
  expect(markup).toContain('data-slot="scroll-area-viewport"');
  expect(markup).toContain('aria-label="Pin Chat on Projects"');
});
test("configuration fallback and unavailable task discovery retain recovery paths", () => {
  const config = renderToStaticMarkup(
    <WorktreeConfigurationSource
      disabled={false}
      onSelect={noop}
      worktree={{
        ...worktree,
        configuration: {
          ...worktree.configuration,
          preference: "checkout",
          error: "Missing configuration",
        },
      }}
    />
  );
  expect(config).toContain("Using Project default");
  expect(config).toContain("Missing configuration");
  const tasks = renderToStaticMarkup(
    <CodexTasksSection
      discoveryUnavailable
      loading={false}
      tasks={[]}
      worktreePath="/tmp/project"
    />
  );
  expect(tasks).toContain("Task discovery is temporarily unavailable");
  expect(tasks).toContain("New task");
});
