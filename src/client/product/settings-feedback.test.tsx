import { afterEach, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { delay } from "../../adapters/host/polling";
import { WorkspaceSnapshotSchema } from "../../project/worktree-status-contract";
import type { ProductSection } from "./location";
import { SettingsPage } from "./settings-page";

const snapshot = WorkspaceSnapshotSchema.parse({
  globalProcesses: [],
  globalRunningCount: 0,
  mainWorktreePath: "/repo",
  projectDefaultConfig: {
    appGroups: {
      web: {
        apps: { web: { protocol: "http" } },
        start: { argv: ["bun", "dev"] },
        stop: "process",
      },
    },
    setup: { argv: ["bun", "install"] },
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
  updatedAt: "2026-09-20T12:00:00Z",
  worktrees: [],
});
let root: Root | undefined;
let client: QueryClient | undefined;
let dom: Window | undefined;
let previous: Record<string, PropertyDescriptor | undefined> = {};
const originalFetch = globalThis.fetch;

afterEach(async () => {
  await act(() => root?.unmount());
  client?.clear();
  await dom?.happyDOM.close();
  for (const [name, descriptor] of Object.entries(previous)) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  globalThis.fetch = originalFetch;
});

test("save, removal and trust keep independent pending and inline feedback", async () => {
  dom = new Window({ url: "http://localhost/" });
  const globals = {
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.MutationObserver,
    Node: dom.Node,
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    document: dom.document,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client = queryClient;
  client.setQueryData(["project-status", "/repo"], {});
  client.setQueryData(["project-status", "/other"], {});
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  const render = (section: ProductSection) =>
    act(() =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <SettingsPage
            data={snapshot}
            section={section}
            onSectionChange={() => {}}
            review={() => {}}
          />
        </QueryClientProvider>
      )
    );
  const button = (text: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === text
    );
    if (!found) {
      throw new Error(`Missing button: ${text}`);
    }
    return found;
  };
  const click = (text: string) =>
    act(async () => {
      button(text).click();
      await delay(20);
    });
  const deferredSave = Promise.withResolvers<Response>();
  let saves = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    const path = String(input);
    if (path === "/api/session") {
      return Promise.resolve(Response.json({ token: "token" }));
    }
    if (path.endsWith("/save-project")) {
      saves += 1;
      return deferredSave.promise;
    }
    return Promise.resolve(
      Response.json(
        {
          error: path.endsWith("/remove-project")
            ? "Stop groups before removal"
            : "Stop groups before revoking",
        },
        { status: 409 }
      )
    );
  }) as typeof fetch;
  await render("general");
  await click("Save changes");
  expect(button("Saving…").disabled).toBe(true);
  expect(container.querySelector("input")?.disabled).toBe(true);
  await click("Saving…");
  expect(saves).toBe(1);
  await click("Remove project…");
  expect(button("Remove project").disabled).toBe(true);
  // Removal and save must serialize: a late save could re-add a removed project.
  await render("command trust");
  await click("Revoke project approvals");
  expect(container.textContent).toContain("Stop groups before revoking");
  await render("general");
  expect(button("Saving…").disabled).toBe(true);
  expect(container.textContent).not.toContain("Stop groups before revoking");
  expect(container.textContent).not.toContain("Project saved.");
  await act(async () => {
    deferredSave.resolve(
      Response.json({ command: "save-project", message: "Saved", ok: true })
    );
    await delay(20);
  });
  expect(container.textContent).toContain("Project saved.");
  expect(button("Remove project").disabled).toBe(false);
  await click("Remove project");
  expect(container.textContent).toContain("Stop groups before removal");
  await render("command trust");
  await click("Revoke project approvals");
  expect(container.textContent).toContain("Stop groups before revoking");
  expect(client.getQueryState(["project-status", "/repo"])?.isInvalidated).toBe(
    true
  );
  expect(
    client.getQueryState(["project-status", "/other"])?.isInvalidated
  ).toBe(false);
  expect(container.textContent).not.toContain("Stop groups before removal");
  await render("general");
  expect(container.textContent).toContain("Stop groups before removal");
  expect(container.textContent).not.toContain("Stop groups before revoking");
});
