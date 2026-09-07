import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  DetectedService,
  Observation,
} from "../../controller/discovery-contract";
import type { ProjectOverview } from "../../controller/product-contract";
import type { ProductLocation } from "./data";
import { ObservedProjectPage, ServiceLink } from "./observed-project-page";
import { ProjectsPage, projectIsActive } from "./projects-page";

const service: DetectedService = {
  address: "127.0.0.1:3000",
  command: "node",
  cwd: "/code/app",
  managed: false,
  pid: 42,
  port: 3000,
  resources: null,
  startedAt: null,
  url: null,
};
const data: Observation = {
  configured: false,
  repoPath: "/code/app",
  updatedAt: "2026-09-06T12:00:00Z",
  warning: null,
  worktrees: [
    {
      branch: "main",
      id: "main",
      isMain: true,
      path: "/code/app",
      services: [
        service,
        { ...service, pid: 43, port: 3001 },
        { ...service, pid: 44, port: 3002 },
      ],
    },
  ],
};
const project: ProjectOverview = {
  addedAt: data.updatedAt,
  error: null,
  name: "App",
  observation: data,
  path: data.repoPath,
  pins: [],
  workspace: null,
};
const location: ProductLocation = {
  group: "",
  panel: "logs",
  repo: data.repoPath,
  section: "general",
  view: "workspace",
  worktree: "",
};
function render(child: ReactNode, projects: ProjectOverview[] = [project]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["projects"], projects);
  client.setQueryData(["codex-integration", data.repoPath], {
    updatedAt: data.updatedAt,
    worktrees: { main: { tasks: [] } },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>{child}</QueryClientProvider>
  );
  client.clear();
  return html;
}
test("unconfigured projects show observed worktrees and extra service access without lifecycle controls", () => {
  const html = render(
    <ObservedProjectPage data={data} location={location} project={project} />
  );
  expect(html).toContain("Observing");
  expect(html).toContain("Main worktree");
  expect(html).toContain('aria-label="1 more services"');
  expect(html).toContain("Configure app groups");
  expect(html).not.toContain(">Start<");
  expect(html).not.toContain(">Stop<");
  expect(html).not.toContain("Missing worktree environment config");
  expect(html).toContain('aria-label="Copy path for main"');
});
test("TCP listeners have copy access but Open requires a verified HTTP response", () => {
  const tcp = renderToStaticMarkup(<ServiceLink service={service} />);
  expect(tcp).toContain("TCP");
  expect(tcp).toContain("Copy address for port 3000");
  expect(tcp).not.toContain("href=");
  const http = renderToStaticMarkup(
    <ServiceLink service={{ ...service, url: "http://127.0.0.1:3000" }} />
  );
  expect(http).toContain('href="http://127.0.0.1:3000"');
  expect(http).toContain("Open port 3000");
});
test("detected listeners make a project active and quiet unconfigured projects are neutral", () => {
  const quiet = {
    ...project,
    name: "A quiet project",
    observation: { ...data, worktrees: [] },
    path: "/code/quiet",
  };
  expect(projectIsActive(project)).toBe(true);
  expect(projectIsActive(quiet)).toBe(false);
  const html = render(<ProjectsPage />, [quiet, project]);
  expect(html.indexOf(">App</a>")).toBeLessThan(
    html.indexOf(">A quiet project</a>")
  );
  expect(html).toContain("3 services detected");
  expect(html).toContain("Observing");
  expect(html).not.toContain("Inspection unavailable");
});
test("unconfigured Infrastructure and Settings offer explicit configuration without empty errors", () => {
  for (const view of ["infrastructure", "settings"] as const) {
    const html = render(
      <ObservedProjectPage
        data={data}
        location={{ ...location, view }}
        project={project}
      />
    );
    expect(html).toContain("Configure app groups");
    expect(html).not.toContain('role="alert"');
  }
});
