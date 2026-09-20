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
    dom.history.replaceState(null, "", "/?view=machine");
    expect(initialLocation().view).toBe("machine");
    rememberLocation(initialLocation());
    dom.history.replaceState(null, "", "/");
    expect(initialLocation().worktree).toBe("feature");
    dom.localStorage.setItem(
      "branchbase:last-location:v1",
      "/?repo=/project&page=settings&section=command%20trust&group=orphan"
    );
    dom.history.replaceState(null, "", "/");
    expect(initialLocation()).toMatchObject({
      group: "",
      section: "command trust",
      view: "settings",
    });
    for (const saved of [
      "/?repo=/project&view=running",
      "/other?repo=/project",
      "http://[",
      "/?repo=",
    ]) {
      dom.localStorage.setItem("branchbase:last-location:v1", saved);
      dom.history.replaceState(null, "", "/");
      expect(initialLocation().repo).toBe("");
    }
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
