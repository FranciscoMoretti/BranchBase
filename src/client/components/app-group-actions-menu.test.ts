import { describe, expect, it } from "bun:test";

import type { AppGroupSnapshot } from "../../controller/workspace-snapshot";
import { appGroupCommandMenuItems } from "./app-group-actions-menu";

const group = (health: AppGroupSnapshot["health"]): AppGroupSnapshot => ({
  apps: [],
  health,
  id: "product",
  instance: { id: "product-main", mode: "per-worktree", name: "main" },
  instances: [{ id: "product-main", name: "main", running: false }],
  name: "Product Apps",
  processRunning: false,
  stop: "process",
});

const itemIds = (target: AppGroupSnapshot): string[] =>
  appGroupCommandMenuItems({
    group: target,
    onRestart: () => undefined,
    onRetry: () => undefined,
    onToggle: () => undefined,
    pending: false,
  }).map((item) => item.id);

describe("app group actions menu", () => {
  it("offers start for a stopped group", () => {
    expect(itemIds(group("not-running"))).toEqual(["start"]);
  });

  it("offers stop and restart for a running group", () => {
    expect(itemIds(group("running"))).toEqual(["stop", "restart"]);
  });

  it("offers only cleanup for a detached run", () => {
    expect(itemIds({ ...group("not-running"), cleanupOnly: true })).toEqual([
      "stop",
    ]);
  });

  it("offers retry while a group is partially running", () => {
    expect(itemIds(group("partially-running"))).toEqual([
      "stop",
      "retry",
      "restart",
    ]);
  });

  it("offers retry when a running group has an unavailable route", () => {
    const unavailable = group("running");
    unavailable.apps = [
      {
        directUrl: "http://127.0.0.1:3000",
        id: "web",
        label: "Web",
        listening: true,
        open: false,
        ownership: "owned",
        port: 3000,
        protocol: "http",
        readiness: "ready",
        routeState: "unavailable",
        url: null,
      },
    ];

    expect(itemIds(unavailable)).toEqual(["stop", "retry", "restart"]);
  });
});
