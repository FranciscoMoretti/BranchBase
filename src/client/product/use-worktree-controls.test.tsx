import { expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { worktree } from "./test-fixtures";
import { useWorktreeControls } from "./use-worktree-controls";

const shared = {
  apps: worktree.apps,
  health: "running" as const,
  id: "web",
  instance: { id: "shared", mode: "selectable" as const, name: "Shared" },
  instances: [],
  name: "Web",
  processRunning: true,
  stop: "process" as const,
};
const data: WorkspaceSnapshot = {
  globalProcesses: [],
  globalRunningCount: 1,
  mainWorktreePath: worktree.path,
  projectDefaultConfig: {
    appGroups: {},
    setup: { argv: ["true"] },
    version: 1,
  },
  projectDefaultConfigPath: worktree.configuration.path,
  projectDefaultConfigRevision: "revision",
  projectDefaultPrimaryAppGroup: shared.id,
  repoName: "Project",
  repoPath: "/tmp/project",
  trustCommands: [],
  trustFingerprint: "fingerprint",
  trustRequired: true,
  trusted: false,
  updatedAt: "2026-09-20T00:00:00Z",
  worktrees: [
    { ...worktree, appGroups: [shared] },
    { ...worktree, appGroups: [shared], id: "consumer" },
  ],
};

const BlockingState = () => {
  const { controls } = useWorktreeControls({ data, onInspect: () => {} });
  return <span>{String(controls.blocked(data.worktrees[0], shared))}</span>;
};

test("shared controls block every consumer while a command targets another consumer", async () => {
  const client = new QueryClient();
  const deferred = Promise.withResolvers<undefined>();
  const mutation = client.getMutationCache().build(client, {
    mutationFn: (_input: {
      repoPath: string;
      worktreeId: string;
      appGroupName: string;
    }) => deferred.promise,
    mutationKey: ["command", "stop-apps"],
  });
  const pending = mutation.execute({
    appGroupName: shared.id,
    repoPath: data.repoPath,
    worktreeId: "consumer",
  });
  const render = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <BlockingState />
      </QueryClientProvider>
    );
  expect(render()).toContain("true");
  await Promise.resolve();
  deferred.resolve();
  await pending;
  expect(render()).toContain("false");
  client.clear();
});

test("pending commands in another repository do not block these shared controls", async () => {
  const client = new QueryClient();
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async (_input: {
      repoPath: string;
      worktreeId: string;
      appGroupName: string;
    }) => {},
    mutationKey: ["command", "stop-apps"],
  });
  const pending = mutation.execute({
    appGroupName: shared.id,
    repoPath: "/other",
    worktreeId: "consumer",
  });
  expect(
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <BlockingState />
      </QueryClientProvider>
    )
  ).toContain("false");
  await pending;
  client.clear();
});
