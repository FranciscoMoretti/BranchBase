import { afterEach, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ThemeProvider } from "../components/theme-provider";

let dom: Window | null = null;
let root: Root | null = null;
let originalGlobals: Record<string, PropertyDescriptor | undefined>;

const mount = async () => {
  dom = new Window({ url: "http://localhost/?view=machine" });
  const names = [
    "document",
    "Element",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "CustomEvent",
    "navigator",
    "Node",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "MutationObserver",
    "window",
  ];
  originalGlobals = Object.fromEntries(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  Object.assign(globalThis, {
    CustomEvent: dom.CustomEvent,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.window.MutationObserver,
    Node: dom.Node,
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    document: dom.document,
    navigator: dom.navigator,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    window: dom,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["development-folders"], []);
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  const { ProductApp } = await import("./product-app");
  root = createRoot(container as unknown as HTMLElement);
  act(() => {
    root?.render(
      <ThemeProvider defaultTheme="light">
        <QueryClientProvider client={client}>
          <ProductApp />
        </QueryClientProvider>
      </ThemeProvider>
    );
  });
};

afterEach(async () => {
  if (root) {
    await act(() => root?.unmount());
  }
  root = null;
  dom = null;
  for (const [name, descriptor] of Object.entries(originalGlobals ?? {})) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

const waitForHistoryEvent = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

const settleHistory = async () => {
  await act(async () => {
    await waitForHistoryEvent();
    await waitForHistoryEvent();
  });
};

const setDirty = (value: boolean) => {
  if (!dom) {
    throw new Error("DOM was not installed");
  }
  window.dispatchEvent(
    new CustomEvent("branchbase:settings-dirty", {
      detail: value,
    } as never)
  );
};

const dialogButton = (label: string) => {
  if (!dom) {
    throw new Error("DOM was not installed");
  }
  const button = [...dom.document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(
      `Missing dialog button: ${label}; URL=${dom.window.location.href}; body=${dom.document.body.textContent}`
    );
  }
  return button;
};

test("dirty Back cancel then discard preserves indexed history", async () => {
  await mount();
  if (!dom) {
    throw new Error("DOM was not installed");
  }
  const appDom = dom;
  await settleHistory();
  const { history } = appDom.window;
  const anchor = appDom.document.createElement("a");
  anchor.href = "/?view=machine&section=configuration";
  anchor.textContent = "Settings";
  dom.document.body.append(anchor);
  act(() => {
    anchor.dispatchEvent(
      new appDom.window.MouseEvent("click", { bubbles: true, button: 0 })
    );
  });
  expect(appDom.window.location.search).toBe(
    "?view=machine&section=configuration"
  );
  expect(history.length).toBe(2);
  const lengthAfterPush = history.length;

  await act(async () => {
    setDirty(true);
    await waitForHistoryEvent();
    history.back();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
  });
  expect(appDom.window.location.search).toBe(
    "?view=machine&section=configuration"
  );
  expect(history.length).toBe(lengthAfterPush);
  await act(async () => {
    dialogButton("Keep editing").click();
    await waitForHistoryEvent();
  });
  expect(appDom.window.location.search).toBe(
    "?view=machine&section=configuration"
  );
  expect(history.length).toBe(lengthAfterPush);

  await act(async () => {
    history.back();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
  });
  await act(async () => {
    dialogButton("Leave and keep draft").click();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
  });
  expect(appDom.window.location.search).toBe("?view=machine");
  expect(history.length).toBe(lengthAfterPush);

  await act(async () => {
    history.forward();
    await waitForHistoryEvent();
    await waitForHistoryEvent();
  });
  expect(appDom.window.location.search).toBe(
    "?view=machine&section=configuration"
  );
  expect(history.length).toBe(lengthAfterPush);
});
