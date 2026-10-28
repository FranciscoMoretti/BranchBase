import { expect, expectTypeOf, test } from "bun:test";
import { setTimeout } from "node:timers/promises";

import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";

import type {
  BranchBaseCommandInput,
  BranchBaseCommandResult,
} from "../application/command-contract";
import { invalidateCommandQueries } from "./command-invalidation";
import type { useCommand } from "./mutations";
import type { ProductCommandInput } from "./product/data";

const keys = [
  ["projects"],
  ["development-folders"],
  ["activity", "all"],
  ...["/repo", "/other"].flatMap((repo) => [
    ["project-status", repo],
    ["workspace", repo],
    ["observation", repo],
    ["activity", repo],
    ["logs", repo, "main", "web"],
    ["logs", repo, "shared-alias", "web"],
    ["codex-integration", repo],
  ]),
];
const seededClient = () => {
  const client = new QueryClient();
  for (const key of keys) {
    client.setQueryData(key, {});
  }
  return client;
};
const staleKeys = (client: QueryClient) =>
  keys.filter((key) => client.getQueryState(key)?.isInvalidated);

test("lifecycle invalidation refreshes counts, the affected project, activity and shared log aliases only", async () => {
  const client = seededClient();
  await invalidateCommandQueries(client, "stop-apps", {
    appGroupName: "web",
    repoPath: "/repo",
    worktreeId: "main",
  });
  expect(staleKeys(client)).toEqual(
    keys.filter(
      (key) =>
        key[0] === "projects" ||
        (key[0] === "activity" && key[1] === "all") ||
        (key[1] === "/repo" && key[0] !== "codex-integration")
    )
  );
  client.clear();
});

test("clearing logs refreshes shared aliases and command activity without refetching project status", async () => {
  const client = seededClient();
  await invalidateCommandQueries(client, "clear-logs", {
    appGroupName: "web",
    repoPath: "/repo",
    worktreeId: "main",
  });
  expect(staleKeys(client)).toEqual(
    keys.filter(
      (key) =>
        (key[0] === "activity" && ["all", "/repo"].includes(key[1] ?? "")) ||
        (key[0] === "logs" && key[1] === "/repo")
    )
  );
  client.clear();
});

test("discovery and identity changes do not refetch every project's runtime", async () => {
  const client = seededClient();
  await invalidateCommandQueries(client, "scan-development-folders", {});
  expect(staleKeys(client)).toEqual([["projects"], ["development-folders"]]);
  client.clear();
  const saved = seededClient();
  await invalidateCommandQueries(saved, "save-project", {
    name: "Renamed",
    repoPath: "/repo",
  });
  expect(staleKeys(saved)).toEqual([
    ["projects"],
    ["activity", "all"],
    ["activity", "/repo"],
  ]);
  saved.clear();
});

test("config source selection refreshes runtime projections and logs without touching another repository", async () => {
  const client = seededClient();
  await invalidateCommandQueries(client, "select-worktree-config-source", {
    repoPath: "/repo",
    source: "checkout",
    worktreeId: "main",
  });
  expect(staleKeys(client)).toContainEqual(["projects"]);
  expect(staleKeys(client)).toContainEqual(["project-status", "/repo"]);
  expect(staleKeys(client)).toContainEqual([
    "logs",
    "/repo",
    "shared-alias",
    "web",
  ]);
  expect(staleKeys(client).some((key) => key[1] === "/other")).toBe(false);
  client.clear();
});

test("mutation inputs retain their command-specific required fields", () => {
  expectTypeOf<
    Parameters<ReturnType<typeof useCommand<"start-apps">>["mutate"]>[0]
  >().toEqualTypeOf<BranchBaseCommandInput<"start-apps">>();
  expectTypeOf<
    ReturnType<typeof useCommand<"pick-repository">>["data"]
  >().toEqualTypeOf<BranchBaseCommandResult<"pick-repository"> | undefined>();
  expectTypeOf<
    Extract<ProductCommandInput, { command: "start-apps" }>
  >().toEqualTypeOf<
    { command: "start-apps" } & BranchBaseCommandInput<"start-apps">
  >();
});

test("completed commands settle while an active catalog refresh is still pending", async () => {
  const client = new QueryClient();
  const refresh = Promise.withResolvers<object>();
  client.setQueryData(["projects"], {});
  const query = new QueryObserver(client, {
    queryFn: () => refresh.promise,
    queryKey: ["projects"],
    staleTime: Infinity,
  });
  const unsubscribe = query.subscribe(() => {});
  const mutation = new MutationObserver(client, {
    mutationFn: () => Promise.resolve("applied"),
    onSettled: () =>
      invalidateCommandQueries(client, "select-resource-profile", {
        profileId: "1",
        repoPath: "/repo",
        restart: false,
        worktreeId: "main",
      }),
  });
  try {
    const result = await Promise.race([
      mutation.mutate(),
      setTimeout(100, "blocked"),
    ]);
    expect(result).toBe("applied");
    expect(query.getCurrentResult().isFetching).toBe(true);
  } finally {
    refresh.resolve({});
    unsubscribe();
    client.clear();
  }
});
