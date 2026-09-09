import { afterEach, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { RecoveryBoundary } from "../components/recovery-boundary";
import { Button } from "../components/ui/button";
import { useRepositoryOpen } from "../use-repository-open";
import { useRepositoryPicker } from "../use-repository-picker";
import { ActivityPage } from "./activity-page";
import { ActionFeedback, FormFeedback, QueryContent } from "./async-state";
import type { QueryState } from "./async-state";
import { ProjectsPage } from "./projects-page";

const base: QueryState = {
  data: undefined,
  error: null,
  isFetching: true,
  isPending: true,
  refetch: () => {},
};
let activeRoot: Root | null = null;
let activeDom: Window | null = null;
const globalNames = [
  "document",
  "Element",
  "HTMLElement",
  "IS_REACT_ACT_ENVIRONMENT",
  "navigator",
  "Node",
  "window",
] as const;
let activePreviousGlobals = new Map<string, PropertyDescriptor | undefined>();
const mountDom = () => {
  activePreviousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  activeDom = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, {
    Element: activeDom.Element,
    HTMLElement: activeDom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: activeDom.Node,
    document: activeDom.document,
    navigator: activeDom.navigator,
    window: activeDom,
  });
  const container = activeDom.document.createElement("div");
  activeDom.document.body.append(container);
  activeRoot = createRoot(container as unknown as HTMLElement);
  return container;
};
const OpenHarness = () => {
  const state = useRepositoryOpen(() => Promise.resolve());
  return (
    <>
      <Button onClick={() => state.open("/repo")} type="button">
        Open
      </Button>
      <output data-status>{state.pending ? "pending" : "idle"}</output>
      <p>{state.error?.message}</p>
    </>
  );
};
const PickerHarness = () => {
  const state = useRepositoryPicker();
  return (
    <>
      <Button onClick={() => state.handleBrowse()} type="button">
        Browse
      </Button>
      <output data-status>{state.pending ? "pending" : "idle"}</output>
      <p>{state.error}</p>
    </>
  );
};
afterEach(async () => {
  if (activeRoot) {
    await act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  activeDom = null;
  for (const name of globalNames) {
    const descriptor = activePreviousGlobals.get(name);
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});
const region = (overrides: Partial<QueryState>) =>
  renderToStaticMarkup(
    <QueryContent label="Projects" query={{ ...base, ...overrides }}>
      <p>Saved project</p>
    </QueryContent>
  );
test("initial load reserves the same content region as initial failure, without claiming an empty list", () => {
  const loading = region({});
  const failed = region({
    error: new TypeError("Failed to fetch"),
    isFetching: false,
    isPending: false,
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
    isFetching: false,
    isPending: false,
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
test("retry recovery stays visible until data arrives and resets for a new query", async () => {
  const container = mountDom();
  const query = {
    ...base,
    error: new Error("Failed to fetch"),
    isFetching: false,
    isPending: false,
  };
  await act(() => {
    activeRoot?.render(
      <QueryContent label="Projects" query={query} resetKey="observation">
        <p>Saved project</p>
      </QueryContent>
    );
  });
  expect(container.textContent).toContain("Try again");
  await act(() => {
    activeRoot?.render(
      <QueryContent
        label="Projects"
        query={{ ...query, error: null, isFetching: true }}
        resetKey="observation"
      >
        <p>Saved project</p>
      </QueryContent>
    );
  });
  expect(container.textContent).toContain("Retrying…");
  await act(() => {
    activeRoot?.render(
      <QueryContent
        label="Projects"
        query={{ ...query, error: null, isFetching: true }}
        resetKey="workspace"
      >
        <p>Saved project</p>
      </QueryContent>
    );
  });
  expect(container.textContent).toContain("Loading projects");
  expect(container.textContent).not.toContain("Try again");
});
test("retry keeps an initial failure visible when no reset key is supplied", async () => {
  const container = mountDom();
  const query = {
    ...base,
    error: new Error("Failed to fetch"),
    isFetching: false,
    isPending: false,
  };
  await act(() => {
    activeRoot?.render(
      <QueryContent label="Projects" query={query}>
        <p>Saved project</p>
      </QueryContent>
    );
  });
  const retry = container.querySelector("button");
  expect(retry).not.toBeNull();
  await act(() => {
    retry?.click();
  });
  await act(() => {
    activeRoot?.render(
      <QueryContent
        label="Projects"
        query={{ ...query, error: null, isFetching: true }}
      >
        <p>Saved project</p>
      </QueryContent>
    );
  });
  expect(container.textContent).toContain("Retrying…");
});
test("DOM feedback exposes loading and mutation failure states", async () => {
  const container = mountDom();
  await act(() => {
    activeRoot?.render(
      <>
        <QueryContent label="Projects" query={base}>
          <p>Saved project</p>
        </QueryContent>
        <FormFeedback error={new Error("Save failed")} title="Could not save" />
      </>
    );
  });
  expect(container.querySelector("output")?.textContent).toContain(
    "Loading projects"
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save"
  );
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
const page = (
  kind: "projects" | "activity",
  status: "pending" | "error" | "success"
) => {
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
        error: new TypeError("Failed to fetch"),
        fetchStatus: "idle",
        status: "error",
      });
  }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      {kind === "projects" ? <ProjectsPage /> : <ActivityPage />}
    </QueryClientProvider>
  );
  client.clear();
  return html;
};
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
test("repository open clears pending state after a rejected request", async () => {
  const container = mountDom();
  await act(() => activeRoot?.render(<OpenHarness />));
  const open = container.querySelector("button");
  expect(open).not.toBeNull();
  await act(() => open?.click());
  expect(container.querySelector("[data-status]")?.textContent).toBe("idle");
  expect(container.textContent).toContain(
    "Connection to BranchBase is unavailable"
  );
});
test("repository picker clears pending state after a rejected request", async () => {
  const container = mountDom();
  await act(() => activeRoot?.render(<PickerHarness />));
  const browse = container.querySelector("button");
  expect(browse).not.toBeNull();
  await act(() => browse?.click());
  expect(container.querySelector("[data-status]")?.textContent).toBe("idle");
  expect(container.textContent).toContain(
    "Connection to BranchBase is unavailable"
  );
});
test("recovery boundary remounts children after a render failure", async () => {
  const container = mountDom();
  let shouldThrow = true;
  const FlakyContent = () => {
    if (shouldThrow) {
      throw new Error("Transient render failure");
    }
    return <p>Recovered content</p>;
  };
  await act(() => {
    activeRoot?.render(
      <RecoveryBoundary
        description="Try again to restore the interface."
        title="The interface stopped"
      >
        <FlakyContent />
      </RecoveryBoundary>
    );
  });
  expect(container.textContent).toContain("Try again");
  shouldThrow = false;
  const retry = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Try again")
  );
  expect(retry).not.toBeNull();
  await act(() => retry?.click());
  expect(container.textContent).toContain("Recovered content");
});
