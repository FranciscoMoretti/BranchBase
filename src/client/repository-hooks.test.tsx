import { afterEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { Button } from "./components/ui/button";
import { useRepositoryOpen } from "./use-repository-open";
import { useRepositoryPicker } from "./use-repository-picker";

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
const previousGlobals = new Map(
  globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ])
);

const mountDom = () => {
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

afterEach(async () => {
  if (activeRoot) {
    await act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  activeDom = null;
  for (const name of globalNames) {
    const descriptor = previousGlobals.get(name);
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

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
