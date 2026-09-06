import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityPage } from "./activity-page";
import { ActionFeedback, QueryContent, type QueryState } from "./async-state";
import { ProjectsPage } from "./projects-page";

const base: QueryState = {
  data: undefined,
  error: null,
  isPending: true,
  isFetching: true,
  refetch: () => undefined,
};
function region(overrides: Partial<QueryState>) {
  return renderToStaticMarkup(
    <QueryContent label="Projects" query={{ ...base, ...overrides }}>
      <p>Saved project</p>
    </QueryContent>
  );
}
test("initial load reserves the same content region as initial failure, without claiming an empty list", () => {
  const loading = region({});
  const failed = region({
    error: new TypeError("Failed to fetch"),
    isPending: false,
    isFetching: false,
  });
  for (const html of [loading, failed]) {
    expect(html).toContain("product-query-status");
    expect(html).toContain("product-query-body");
    expect(html).not.toContain("Saved project");
  }
  expect(loading).toContain('aria-busy="true"');
  expect(failed).toContain("connect to BranchBase");
  expect(failed).toContain("Try again");
  expect(failed).toContain("Technical details");
});
test("refresh failure preserves usable content and offers a read-only retry", () => {
  const html = region({
    data: [1],
    error: new Error("Failed to fetch"),
    isPending: false,
    isFetching: false,
  });
  expect(html).toContain("Saved project");
  expect(html).toContain("Showing the last successful update");
  expect(html).toContain("Retry");
  expect(html).not.toContain("product-unavailable");
  expect(region({ data: [1], isPending: false })).toContain("Saved project");
});
test("retry stays in the failure panel and disables duplicate retry clicks", () => {
  const html = region({
    error: new Error("Failed to fetch"),
    isFetching: true,
    isPending: false,
  });
  expect(html).toContain("Retrying…");
  expect(html).toContain("disabled");
  expect(html).not.toContain("product-skeleton-row");
});
test("action connection failure explains uncertain outcome and has no automatic replay", () => {
  const html = renderToStaticMarkup(
    <ActionFeedback error={new Error("Failed to fetch")} />
  );
  expect(html).toContain("The action may have completed");
  expect(html).toContain("Dismiss error");
  expect(html).not.toContain("Try again");
  expect(html).toContain('role="alert"');
});
function page(
  kind: "projects" | "activity",
  status: "pending" | "error" | "success"
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = kind === "projects" ? ["projects"] : ["activity", "all"];
  if (status === "success") {
    client.setQueryData(key, []);
  }
  if (status === "error") {
    client
      .getQueryCache()
      .build(client, { queryKey: key })
      .setState({
        status: "error",
        error: new TypeError("Failed to fetch"),
        fetchStatus: "idle",
      });
  }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {kind === "projects" ? <ProjectsPage /> : <ActivityPage />}
    </QueryClientProvider>
  );
  client.clear();
  return html;
}
test("Projects never turns loading or failed requests into zero projects or an empty state", () => {
  for (const status of ["pending", "error"] as const) {
    const html = page("projects", status);
    expect(html).not.toContain("0 projects");
    expect(html).not.toContain("No projects");
  }
  expect(page("projects", "success")).toContain("No projects yet");
});
test("Activity separates unavailable history from successfully empty history", () => {
  expect(page("activity", "error")).not.toContain("No matching activity");
  expect(page("activity", "pending")).not.toContain("No matching activity");
  expect(page("activity", "success")).toContain("No matching activity");
});
