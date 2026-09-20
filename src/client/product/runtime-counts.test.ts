import { expect, test } from "bun:test";

import type { DetectedService } from "../../project/discovery-contract";
import type { AppGroupSnapshot } from "../../project/worktree-status-contract";
import { runtimeCounts } from "./runtime-counts";
import { worktree } from "./test-fixtures";

const group: AppGroupSnapshot = {
  apps: [],
  health: "running",
  id: "web",
  instance: { id: "shared", mode: "selectable", name: "web" },
  instances: [],
  name: "web",
  processRunning: true,
  stop: "process",
};
const service: DetectedService = {
  address: "127.0.0.1:3000",
  command: "bun server.ts",
  cwd: "/repo",
  managed: false,
  pid: 42,
  port: 3000,
  resources: null,
  startedAt: null,
  url: "http://127.0.0.1:3000",
};
const observed = (services: DetectedService[]) => ({
  worktrees: [{ ...worktree, services }],
});

test("detected-only repositories have nonzero activity without managed groups", () => {
  expect(
    runtimeCounts([{ observation: observed([service]), path: "/repo" }])
  ).toEqual({
    detectedServices: 1,
    managedGroups: 0,
  });
});
test("counts shared managed instances once per repository and excludes stopped groups", () => {
  const stopped = {
    ...group,
    health: "not-running" as const,
    instance: { ...group.instance, id: "stopped" },
    processRunning: false,
  };
  const workspace = {
    worktrees: [
      { ...worktree, appGroups: [group, stopped] },
      { ...worktree, appGroups: [group], id: "other" },
    ],
  };
  expect(
    runtimeCounts([
      { path: "/one", workspace },
      { path: "/two", workspace },
    ])
  ).toEqual({ detectedServices: 0, managedGroups: 2 });
});
test("managed listeners are not counted again, duplicate observations are deduplicated, and separate ports remain distinct", () => {
  const observation = observed([
    service,
    { ...service, address: "[::1]:3000" },
    { ...service, port: 3001 },
    { ...service, managed: true, pid: 99 },
  ]);
  expect(
    runtimeCounts([
      { observation, path: "/repo" },
      { observation, path: "/alias" },
    ])
  ).toEqual({ detectedServices: 2, managedGroups: 0 });
});
