import { afterEach, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { RecoveryBoundary } from "./recovery-boundary";

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

test("retry remounts children after a render failure", async () => {
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
