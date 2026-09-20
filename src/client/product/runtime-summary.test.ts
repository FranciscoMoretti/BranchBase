import { expect, test } from "bun:test";

import type { AppGroupSnapshot } from "../../project/worktree-status-contract";
import {
  endpointRuntime,
  runtimeSummary,
  worktreeRuntimeReasons,
} from "./runtime-summary";
import { worktree } from "./test-fixtures";

const group = (health: AppGroupSnapshot["health"]): AppGroupSnapshot => ({
  apps: [],
  health,
  id: health,
  instance: { id: health, mode: "per-worktree", name: "main" },
  instances: [],
  name: health,
  processRunning: health !== "not-running",
  stop: "process",
});
test("a running app group cannot hide a stopped sibling in worktree navigation", () => {
  const summary = runtimeSummary({
    ...worktree,
    appGroups: [group("running"), group("not-running")],
    health: "running",
  });
  expect(summary.label).toBe("Partially running");
  expect(summary.value).toBe("partial");
});
test("setup failures and setup in progress take precedence over endpoint readiness", () => {
  const data = {
    ...worktree,
    appGroups: [group("running")],
    health: "running" as const,
  };
  expect(runtimeSummary({ ...data, setupState: "failed" }).label).toBe(
    "Setup failed"
  );
  expect(runtimeSummary({ ...data, setupState: "running" }).label).toBe(
    "Setting up"
  );
});
test("endpoint readiness does not claim a conflicting route is healthy", () => {
  const data = {
    ...group("running"),
    apps: [{ ...worktree.apps[0], routeState: "conflict" as const }],
  };
  expect(
    runtimeSummary({ ...worktree, appGroups: [data], health: "running" })
  ).toEqual({
    label: "Partially running",
    ready: 1,
    total: 1,
    value: "partial",
  });
});

test("partial worktrees name a stopped sibling even when its controls are hidden", () => {
  const stopped = {
    ...group("not-running"),
    apps: [
      {
        ...worktree.apps[0],
        label: "API",
        listening: false,
        ownership: "none" as const,
        readiness: "unready" as const,
      },
    ],
    name: "api",
  };
  expect(
    worktreeRuntimeReasons({
      ...worktree,
      appGroups: [group("running"), stopped],
      health: "running",
    })
  ).toEqual(["API: Stopped"]);
});

test("endpoint reasons distinguish startup, missing listeners, and foreign ownership", () => {
  const app = {
    ...worktree.apps[0],
    listening: false,
    ownership: "none" as const,
    readiness: "waiting" as const,
  };
  expect(endpointRuntime(app, group("running")).label).toBe(
    "Starting · waiting for readiness"
  );
  expect(endpointRuntime(app, group("not-running")).label).toBe("Stopped");
  expect(
    endpointRuntime({ ...app, readiness: "unready" }, group("running")).label
  ).toBe("Process running · not listening");
  expect(
    endpointRuntime(
      { ...app, listening: true, readiness: "unready" },
      group("running")
    ).label
  ).toBe("Listening · not ready");
  expect(
    endpointRuntime(
      { ...app, ownership: "foreign", readiness: "ready" },
      group("running")
    )
  ).toEqual({ label: "Port in use by another process", value: "partial" });
});

test("a ready endpoint with a broken friendly route explains the route issue", () => {
  for (const routeState of ["conflict", "unavailable"] as const) {
    expect(
      endpointRuntime(
        {
          ...worktree.apps[0],
          ownership: "owned",
          protocol: "http",
          readiness: "ready",
          routeState,
        },
        group("running")
      )
    ).toEqual({ label: `Route ${routeState}`, value: "partial" });
  }
});
