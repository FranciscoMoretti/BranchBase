import { useMutationState } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../controller/workspace-snapshot";
import {
  appGroupIsStopped,
  appsAreStopped,
} from "../controller/workspace-snapshot";
import { useCommands } from "./mutations";
import type { RequestRepositoryTrust } from "./use-repository-trust";
import type { WorktreeCommandActions } from "./worktree-command-menu";

const APP_GROUP_COMMANDS = new Set([
  "create-app-group-instance",
  "restart-apps",
  "retry-apps",
  "select-app-group-instance",
  "start-apps",
  "stop-apps",
]);
const ALL_APP_GROUP_COMMANDS = new Set([
  "restart-running-apps",
  "start-all-apps",
  "stop-all-apps",
]);
const BLOCKING_WORKTREE_COMMANDS = new Set([
  "delete-worktree",
  "select-worktree-config-source",
  "setup-all-apps",
]);

export interface PendingCommand {
  command: string | null;
  variables: unknown;
}

export interface PendingCommandScopes {
  allAppGroups: Set<string>;
  appGroups: Map<string, Set<string>>;
  blockedWorktrees: Set<string>;
  configSourceWorktrees: Set<string>;
  worktrees: Set<string>;
}

const commandInput = (
  value: unknown
): (Record<string, unknown> & { repoPath: string }) | null => {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return null;
  }
  const input = value as Record<string, unknown>;
  return typeof input.repoPath === "string"
    ? (input as Record<string, unknown> & { repoPath: string })
    : null;
};

const requestedWorktreeIds = (input: Record<string, unknown>): string[] => {
  if (typeof input.worktreeId === "string") {
    return [input.worktreeId];
  }
  return Array.isArray(input.worktreeIds)
    ? input.worktreeIds.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
};

const addAppGroupScope = (
  scopes: PendingCommandScopes,
  input: Record<string, unknown>
): void => {
  if (
    typeof input.worktreeId !== "string" ||
    typeof input.appGroupName !== "string"
  ) {
    return;
  }
  const groups = scopes.appGroups.get(input.worktreeId) ?? new Set();
  groups.add(input.appGroupName);
  scopes.appGroups.set(input.worktreeId, groups);
  scopes.worktrees.add(input.worktreeId);
};

const addWorktreeScopes = (
  scopes: PendingCommandScopes,
  worktreeIds: readonly string[],
  allAppGroups: boolean
): void => {
  for (const worktreeId of worktreeIds) {
    if (allAppGroups) {
      scopes.allAppGroups.add(worktreeId);
    }
    scopes.blockedWorktrees.add(worktreeId);
    scopes.worktrees.add(worktreeId);
  }
};

export const pendingCommandScopes = (
  commands: readonly PendingCommand[],
  repoPath: string
): PendingCommandScopes => {
  const scopes: PendingCommandScopes = {
    allAppGroups: new Set(),
    appGroups: new Map(),
    blockedWorktrees: new Set(),
    configSourceWorktrees: new Set(),
    worktrees: new Set(),
  };
  for (const pending of commands) {
    const input = commandInput(pending.variables);
    if (!(input && input.repoPath === repoPath && pending.command)) {
      continue;
    }
    if (APP_GROUP_COMMANDS.has(pending.command)) {
      addAppGroupScope(scopes, input);
      continue;
    }
    const worktreeIds = requestedWorktreeIds(input);
    if (pending.command === "select-worktree-config-source") {
      for (const worktreeId of worktreeIds) {
        scopes.configSourceWorktrees.add(worktreeId);
      }
    }
    if (ALL_APP_GROUP_COMMANDS.has(pending.command)) {
      addWorktreeScopes(scopes, worktreeIds, true);
      continue;
    }
    if (BLOCKING_WORKTREE_COMMANDS.has(pending.command)) {
      addWorktreeScopes(scopes, worktreeIds, false);
    }
  }
  return scopes;
};

export const useWorktreeCommandActions = ({
  repoPath,
  requestRepositoryTrust,
  worktrees,
}: {
  repoPath: string;
  requestRepositoryTrust: RequestRepositoryTrust;
  worktrees: WorktreeSnapshot[];
}) => {
  const commands = useCommands(repoPath);
  const pendingCommands = useMutationState<PendingCommand>({
    filters: { mutationKey: ["command"], status: "pending" },
    select: (mutation) => ({
      command:
        typeof mutation.options.mutationKey?.[1] === "string"
          ? mutation.options.mutationKey[1]
          : null,
      variables: mutation.state.variables,
    }),
  });
  const pendingScopes = useMemo(
    () => pendingCommandScopes(pendingCommands, repoPath),
    [pendingCommands, repoPath]
  );
  const appGroupActionPending = useCallback(
    (worktreeId: string, appGroupName: string) =>
      pendingScopes.allAppGroups.has(worktreeId) ||
      (pendingScopes.appGroups.get(worktreeId)?.has(appGroupName) ?? false),
    [pendingScopes]
  );
  const appGroupActionBlocked = useCallback(
    (worktreeId: string, appGroupName: string) =>
      pendingScopes.blockedWorktrees.has(worktreeId) ||
      appGroupActionPending(worktreeId, appGroupName),
    [appGroupActionPending, pendingScopes]
  );
  const worktreeActionPending = useCallback(
    (worktreeId: string) => pendingScopes.worktrees.has(worktreeId),
    [pendingScopes]
  );
  const configSourcePending = useCallback(
    (worktreeId: string) => pendingScopes.configSourceWorktrees.has(worktreeId),
    [pendingScopes]
  );
  const primaryGroup = useCallback(
    (worktree: WorktreeSnapshot) =>
      worktree.appGroups.find((group) => group.id === worktree.primaryAppGroup),
    []
  );
  const trustScope = useCallback(
    (worktree: WorktreeSnapshot) => ({
      approvals: [
        {
          fingerprint: worktree.configuration.trustFingerprint,
          worktreeId: worktree.id,
        },
      ],
      commands: worktree.configuration.trustCommands,
      trusted: worktree.configuration.trusted,
    }),
    []
  );
  const startApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = primaryGroup(worktree)?.id;
      if (!appGroupName) {
        return;
      }
      requestRepositoryTrust(
        "Start apps",
        () => {
          commands.startApps.mutate({
            appGroupName,
            repoPath,
            worktreeId: worktree.id,
          });
        },
        trustScope(worktree)
      );
    },
    [
      commands.startApps,
      primaryGroup,
      repoPath,
      requestRepositoryTrust,
      trustScope,
    ]
  );

  const stopApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = primaryGroup(worktree)?.id;
      if (appGroupName) {
        commands.stopApps.mutate({
          appGroupName,
          repoPath,
          worktreeId: worktree.id,
        });
      }
    },
    [commands.stopApps, primaryGroup, repoPath]
  );

  const restartApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      const appGroupName = primaryGroup(worktree)?.id;
      if (!appGroupName) {
        return;
      }
      requestRepositoryTrust(
        "Restart apps",
        () => {
          commands.restartApps.mutate({
            appGroupName,
            repoPath,
            worktreeId: worktree.id,
          });
        },
        trustScope(worktree)
      );
    },
    [
      commands.restartApps,
      primaryGroup,
      repoPath,
      requestRepositoryTrust,
      trustScope,
    ]
  );

  const setupApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      requestRepositoryTrust(
        "Run setup",
        () => {
          commands.setupAllApps.mutate({
            repoPath,
            worktreeIds: [worktree.id],
          });
        },
        trustScope(worktree)
      );
    },
    [commands.setupAllApps, repoPath, requestRepositoryTrust, trustScope]
  );

  const commandActions = useMemo<WorktreeCommandActions>(
    () => ({
      onRestart: restartApps,
      onSetup: setupApps,
      onStart: startApps,
      onStop: stopApps,
    }),
    [restartApps, setupApps, startApps, stopApps]
  );

  const toggleApps = useCallback(
    (worktree: WorktreeSnapshot) => {
      if (appsAreStopped(worktree)) {
        startApps(worktree);
        return;
      }
      stopApps(worktree);
    },
    [startApps, stopApps]
  );

  const toggleAppGroup = useCallback(
    (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => {
      if (appGroupIsStopped(group)) {
        requestRepositoryTrust(
          `Start ${group.name}`,
          () => {
            commands.startApps.mutate({
              appGroupName: group.id,
              repoPath,
              worktreeId: worktree.id,
            });
          },
          trustScope(worktree)
        );
      } else {
        commands.stopApps.mutate({
          appGroupName: group.id,
          repoPath,
          worktreeId: worktree.id,
        });
      }
    },
    [
      commands.startApps,
      commands.stopApps,
      repoPath,
      requestRepositoryTrust,
      trustScope,
    ]
  );

  const restartAppGroup = useCallback(
    (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => {
      requestRepositoryTrust(
        `Restart ${group.name}`,
        () => {
          commands.restartApps.mutate({
            appGroupName: group.id,
            repoPath,
            worktreeId: worktree.id,
          });
        },
        trustScope(worktree)
      );
    },
    [commands.restartApps, repoPath, requestRepositoryTrust, trustScope]
  );

  const retryAppGroup = useCallback(
    (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => {
      commands.retryApps.mutate({
        appGroupName: group.id,
        repoPath,
        worktreeId: worktree.id,
      });
    },
    [commands.retryApps, repoPath]
  );

  const createAppGroupInstance = useCallback(
    async (
      worktree: WorktreeSnapshot,
      group: AppGroupSnapshot,
      name: string
    ) => {
      await commands.createAppGroupInstance.mutateAsync({
        appGroupName: group.id,
        name,
        repoPath,
        worktreeId: worktree.id,
      });
    },
    [commands.createAppGroupInstance, repoPath]
  );

  const selectAppGroupInstance = useCallback(
    (
      worktree: WorktreeSnapshot,
      group: AppGroupSnapshot,
      instanceId: string
    ) => {
      commands.selectAppGroupInstance.mutate({
        appGroupName: group.id,
        instanceId,
        repoPath,
        worktreeId: worktree.id,
      });
    },
    [commands.selectAppGroupInstance, repoPath]
  );

  const visibleActions = useMemo(() => {
    const worktreeIds = worktrees.map((worktree) => worktree.id);
    const visibleTrustScope = {
      approvals: worktrees.map((worktree) => ({
        fingerprint: worktree.configuration.trustFingerprint,
        worktreeId: worktree.id,
      })),
      commands: [
        ...new Set(
          worktrees.flatMap((worktree) => worktree.configuration.trustCommands)
        ),
      ],
      trusted: worktrees.every((worktree) => worktree.configuration.trusted),
    };
    const pending =
      commands.restartRunningApps.isPending ||
      commands.setupAllApps.isPending ||
      commands.startAllApps.isPending ||
      commands.stopAllApps.isPending;
    return {
      onRestart: () =>
        requestRepositoryTrust(
          "Restart running apps",
          () => commands.restartRunningApps.mutate({ repoPath, worktreeIds }),
          visibleTrustScope
        ),
      onSetup: () =>
        requestRepositoryTrust(
          "Run setup",
          () => commands.setupAllApps.mutate({ repoPath, worktreeIds }),
          visibleTrustScope
        ),
      onStart: () =>
        requestRepositoryTrust(
          "Start all apps",
          () => commands.startAllApps.mutate({ repoPath, worktreeIds }),
          visibleTrustScope
        ),
      onStop: () => commands.stopAllApps.mutate({ repoPath, worktreeIds }),
      pending,
    };
  }, [
    commands.restartRunningApps,
    commands.setupAllApps,
    commands.startAllApps,
    commands.stopAllApps,
    repoPath,
    requestRepositoryTrust,
    worktrees,
  ]);

  return {
    appGroupActionBlocked,
    appGroupActionPending,
    commandActions,
    commands,
    configSourcePending,
    createAppGroupInstance,
    restartAppGroup,
    restartApps,
    retryAppGroup,
    selectAppGroupInstance,
    toggleAppGroup,
    toggleApps,
    visibleActions,
    worktreeActionPending,
  };
};
