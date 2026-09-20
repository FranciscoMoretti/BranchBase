import { expect, test } from "bun:test";

import { Window } from "happy-dom";

import { initialLocation, rememberLocation } from "./saved-location";

test("launch restores the last repository while explicit links and All repositories win", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const dom = new Window({ url: "http://localhost/" });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom,
  });
  try {
    rememberLocation({
      group: "web",
      panel: "logs",
      repo: "/tmp/project",
      section: "general",
      view: "workspace",
      worktree: "feature",
    });
    expect(initialLocation().worktree).toBe("feature");
    dom.history.replaceState(null, "", "/?view=running");
    expect(initialLocation().view).toBe("running");
    dom.history.replaceState(null, "", "/?");
    expect(initialLocation().repo).toBe("");
    dom.localStorage.setItem(
      "branchbase:last-location:v1",
      "https://example.com/?repo=external"
    );
    dom.history.replaceState(null, "", "/");
    expect(initialLocation().repo).toBe("");
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "window", previous);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
