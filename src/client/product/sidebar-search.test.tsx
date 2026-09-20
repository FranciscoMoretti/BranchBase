import { afterEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { delay } from "../../adapters/host/polling";
import type { ProjectOverview } from "../../project/catalog-contract";
import type { SidebarProvider as SidebarProviderComponent } from "../components/ui/sidebar";
import type {
  SearchCatalog,
  SidebarSearch as SidebarSearchComponent,
} from "./sidebar-search";

let SidebarProvider: typeof SidebarProviderComponent;
let SidebarSearch: typeof SidebarSearchComponent;
let dom: Window;
let root: Root;
let previous: Record<string, PropertyDescriptor | undefined>;
const catalog: SearchCatalog = {
  data: undefined,
  error: null,
  isFetching: true,
  isPending: true,
  refetch: () => {},
};
const project: ProjectOverview = {
  addedAt: "2026-09-20T12:00:00Z",
  error: null,
  name: "BranchBase",
  observation: null,
  path: "/code/branchbase",
  pins: [],
  workspace: null,
};
const render = async (projects: SearchCatalog) => {
  await act(async () => {
    root.render(
      <SidebarProvider>
        <ul>
          <SidebarSearch projects={projects} />
        </ul>
      </SidebarProvider>
    );
    await delay(30);
  });
};
const mount = async () => {
  dom = new Window({ url: "http://localhost/" });
  const globals = {
    Element: dom.Element,
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.MutationObserver,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    document: dom.document,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    navigator: dom.navigator,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    window: dom,
  };
  previous = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  Object.assign(globalThis, globals);
  ({ SidebarProvider } = await import("../components/ui/sidebar"));
  ({ SidebarSearch } = await import("./sidebar-search"));
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  await render(catalog);
  await act(async () => {
    dom.document.dispatchEvent(
      new dom.KeyboardEvent("keydown", {
        bubbles: true,
        ctrlKey: true,
        key: "k",
      })
    );
    await delay(30);
  });
};
const text = () =>
  dom.document.querySelector('[role="dialog"]')?.textContent ?? "";
const click = async (label: string) => {
  const button = [...dom.document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await delay(30);
  });
};
afterEach(async () => {
  if (root) {
    await act(() => root.unmount());
  }
  for (const [key, descriptor] of Object.entries(previous ?? {})) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  await dom?.happyDOM.close();
});

test("search keeps initial failure and retry distinct from an empty catalog", async () => {
  await mount();
  expect(text()).toContain("Loading repositories");
  expect(text()).not.toContain("No repositories yet");
  expect(text()).not.toContain("0 results");
  let retries = 0;
  const failed = {
    ...catalog,
    error: new Error("Catalog unavailable"),
    isFetching: false,
    isPending: false,
    refetch: () => {
      retries += 1;
    },
  };
  await render(failed);
  expect(text()).toContain("Couldn't load repositories");
  expect(text()).not.toContain("No repositories yet");
  await click("Try again");
  expect(retries).toBe(1);
  await render({ ...catalog, refetch: failed.refetch });
  expect(text()).toContain("Retrying…");
  expect(text()).toContain("Couldn't load repositories");
  await render({ ...catalog, data: [], isFetching: false, isPending: false });
  expect(text()).toContain("No repositories yet");
  expect(text()).toContain("0 results");
  expect(text()).not.toContain("Couldn't load");
});

test("a failed refresh retains selectable cached results and labels them stale", async () => {
  await mount();
  await render({
    ...catalog,
    data: [project],
    error: new Error("Disconnected"),
    isFetching: false,
    isPending: false,
  });
  expect(text()).toContain("Showing the last successful update");
  expect(text()).toContain("1 result");
  expect(text()).toContain("Last known catalog");
  const result = dom.document.querySelector('[role="option"]');
  expect(result?.getAttribute("href")).toBe("/?repo=%2Fcode%2Fbranchbase");
  let navigations = 0;
  dom.document.addEventListener("click", (event) => {
    if (event.target === result) {
      event.preventDefault();
      navigations += 1;
    }
  });
  await act(async () => {
    result?.dispatchEvent(
      new dom.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })
    );
    await delay(30);
  });
  // cmdk's pointer selection must not replay a modified click as a plain one.
  expect(navigations).toBe(1);
});

test("Command keyboard selection follows the same guarded link exactly once", async () => {
  await mount();
  await render({
    ...catalog,
    data: [project],
    isFetching: false,
    isPending: false,
  });
  const input = dom.document.querySelector("input");
  let guardedNavigations = 0;
  dom.document.addEventListener("click", (event) => {
    if (
      event.target instanceof dom.Element &&
      event.target.closest("a[href]")
    ) {
      event.preventDefault();
      guardedNavigations += 1;
    }
  });
  await act(async () => {
    input?.focus();
    input?.dispatchEvent(
      new dom.KeyboardEvent("keydown", { bubbles: true, key: "Enter" })
    );
    await delay(30);
  });
  expect(guardedNavigations).toBe(1);
  expect(dom.location.href).toBe("http://localhost/");
});
