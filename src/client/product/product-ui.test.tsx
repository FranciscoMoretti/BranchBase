import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceSnapshotSchema } from "../../project/worktree-status-contract";
import type { AppGroupSnapshot } from "../../project/worktree-status-contract";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import {
  CodexTasksSection,
  WorktreeConfigurationSource,
} from "../components/worktree-details";
import { EnvironmentList } from "./environment-list";
import type { GroupControls } from "./environment-list";
import { GroupDetails } from "./group-details";
import { ManagedResourceCatalog } from "./managed-resource-catalog";
import { worktree } from "./test-fixtures";

const noop = () => {};
const controls: GroupControls = {
  blocked: () => false,
  inspect: noop,
  restart: noop,
  retry: noop,
  review: noop,
  toggle: noop,
};
const group = (id: string): AppGroupSnapshot => ({
  apps: worktree.apps,
  health: "partially-running",
  id,
  instance: { id: `${id}-instance`, mode: "per-worktree", name: "main" },
  instances: [],
  name: id,
  processRunning: true,
  stop: "process",
});
const list = (
  groups: AppGroupSnapshot[],
  expanded = false,
  runningOnly = false
) =>
  renderToStaticMarkup(
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
      runningOnly={runningOnly}
      onDelete={noop}
      onExpand={noop}
      worktrees={[{ ...worktree, appGroups: groups }]}
    />
  );
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
        onCreateInstance={async () => {}}
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
  const { document } = new Window();
  document.body.innerHTML = markup;
  const table = document.querySelector('table[aria-label="Product endpoints"]');
  expect(table).not.toBeNull();
  if (!table) {
    throw new Error("Missing endpoint table");
  }
  expect(
    [...table.querySelectorAll('thead th[scope="col"]')].map(
      (cell) => cell.textContent
    )
  ).toEqual(["Endpoint", "Readiness", "Access", "Actions"]);
  expect(table.querySelector('tbody th[scope="row"]')?.textContent).toBe(
    "Chat"
  );
  expect(table.querySelectorAll("tbody td")).toHaveLength(3);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  expect(tabs.map((item) => item.textContent)).toEqual([
    "Logs",
    "Activity",
    "Configuration",
    "Tasks",
  ]);
  expect(
    tabs.filter((item) => item.getAttribute("aria-selected") === "true")
  ).toHaveLength(1);
  const selectedTab = tabs.find(
    (item) => item.getAttribute("aria-selected") === "true"
  );
  const panel = document.querySelector('[role="tabpanel"]');
  expect(selectedTab?.textContent).toBe("Logs");
  expect(panel?.textContent).toContain("Server ready");
  expect(panel?.textContent).not.toContain("Review worktree commands");
  expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
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
          error: "Missing configuration",
          preference: "checkout",
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

test("input group addons use native labels to focus their associated control", () => {
  const markup = renderToStaticMarkup(
    <InputGroup>
      <InputGroupAddon htmlFor="repository-path">Browse</InputGroupAddon>
      <InputGroupInput aria-label="Repository path" id="repository-path" />
    </InputGroup>
  );
  expect(markup).toMatch(/<label[^>]*for="repository-path"/u);
  expect(markup).toContain('data-slot="input-group-control"');
});

test("Running hides stopped controls while retaining the complete worktree readiness summary", () => {
  const stopped = {
    ...group("Stopped"),
    apps: [{ ...worktree.apps[1] }],
    health: "not-running" as const,
    processRunning: false,
  };
  const markup = list([group("Product"), stopped], false, true);
  expect(markup).toContain('aria-label="Stop Product in main"');
  expect(markup).not.toContain('aria-label="Start Stopped in main"');
  expect(markup).toContain("Partially running");
  expect(markup).toContain("1/3 ready");
  expect(markup).toContain("Site: Stopped");
  expect(markup).toContain("Site: Process running · not listening");
});

test("Running renders a shared instance once without discarding either worktree snapshot", () => {
  const shared = group("Shared");
  const markup = renderToStaticMarkup(
    <EnvironmentList
      codexError={false}
      commandActions={{
        onRestart: noop,
        onSetup: noop,
        onStart: noop,
        onStop: noop,
      }}
      controls={controls}
      onDelete={noop}
      runningOnly
      worktrees={[
        { ...worktree, appGroups: [shared] },
        {
          ...worktree,
          appGroups: [shared, group("Unique")],
          branch: "feature",
          id: "second",
        },
      ]}
    />
  );
  const { document } = new Window();
  document.body.innerHTML = markup;
  expect(
    document.querySelectorAll('button[aria-label="Stop Shared in main"]')
  ).toHaveLength(1);
  expect(
    document.querySelector('button[aria-label="Stop Shared in feature"]')
  ).toBeNull();
  expect(
    document.querySelector('button[aria-label="Stop Unique in feature"]')
  ).not.toBeNull();
  expect(
    [...document.querySelectorAll(".product-readiness-count")].map(
      (item) => item.textContent
    )
  ).toEqual(["1/2 ready", "2/4 ready"]);
});

const renderCatalog = ({
  approved = true,
  consumers = 0,
  manual = false,
  health = "running",
  observed = true,
}: {
  approved?: boolean;
  consumers?: number;
  manual?: boolean;
  health?: "running" | "partially-running" | "not-running";
  observed?: boolean;
} = {}) => {
  const data = WorkspaceSnapshotSchema.parse({
    globalProcesses: [],
    globalRunningCount: 0,
    mainWorktreePath: "/repo",
    managedResources: [
      {
        approved,
        canBuild: false,
        id: "database",
        instances: ["0"],
        name: "Database",
        observations: observed ? { "0": { consumers, health, manual } } : {},
        path: "/repo/database.json",
        revision: "revision",
      },
    ],
    projectDefaultConfig: {
      appGroups: {
        web: {
          apps: { web: { protocol: "http" } },
          start: { argv: ["bun", "dev"] },
          stop: "process",
        },
      },
      setup: { argv: ["true"] },
      version: 1,
    },
    projectDefaultConfigPath: "/repo/.branchbase.json",
    projectDefaultConfigRevision: "revision",
    projectDefaultPrimaryAppGroup: "web",
    repoName: "Project",
    repoPath: "/repo",
    trustCommands: [],
    trustFingerprint: "fingerprint",
    trustRequired: false,
    trusted: true,
    updatedAt: "2026-10-28T12:00:00Z",
    worktrees: [],
  });
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ManagedResourceCatalog data={data} />
    </QueryClientProvider>
  );
  const dom = new Window();
  dom.document.body.innerHTML = html;
  const buttons = [...dom.document.querySelectorAll("button")];
  const button = (label: string) =>
    buttons.find((item) => item.textContent === label);
  client.clear();
  return { button, html };
};

test("resource lifecycle controls match running and stopped instances", () => {
  const running = renderCatalog();
  expect(running.button("Stop")?.disabled).toBe(false);
  expect(running.button("Restart")?.disabled).toBe(false);
  expect(running.button("Start")).toBeUndefined();
  expect(running.button("Build")).toBeUndefined();
  const stopped = renderCatalog({ health: "not-running" });
  expect(stopped.button("Start")?.disabled).toBe(false);
  expect(stopped.button("Stop")).toBeUndefined();
  expect(stopped.button("Restart")).toBeUndefined();
});

test("resource consumers and manual reservations disable disruptive controls with an explanation", () => {
  for (const state of [{ consumers: 2 }, { manual: true }]) {
    const view = renderCatalog(state);
    expect(view.button("Stop")?.disabled).toBe(true);
    expect(view.button("Restart")?.disabled).toBe(true);
    expect(view.html).toContain(
      "Stop active consumers and finish manual commands"
    );
  }
});

test("unapproved definitions remain reviewable but cannot start", () => {
  const view = renderCatalog({ approved: false, health: "not-running" });
  expect(view.button("Start")?.disabled).toBe(true);
  expect(view.button("Review definition")?.disabled).toBe(false);
  expect(view.html).toContain("Review and approve this definition");
});

test("missing observations are not described as stopped", () => {
  const view = renderCatalog({ observed: false });
  expect(view.html).toContain("Status unavailable");
  expect(view.button("Start")?.disabled).toBe(true);
});
