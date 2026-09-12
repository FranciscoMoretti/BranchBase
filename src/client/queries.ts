import { useQuery } from "@tanstack/react-query";

import {
  fetchCodexIntegration,
  fetchLogs,
  fetchWorkspace,
  fetchProjectStatus,
} from "./api";

export const REFRESH_INTERVAL = 5000;
const CODEX_REFRESH_INTERVAL = 2500;

export const useProjectStatus = (repoPath: string) =>
  useQuery({
    enabled: repoPath !== "",
    queryFn: () => fetchProjectStatus(repoPath),
    queryKey: ["project-status", repoPath],
    refetchInterval: REFRESH_INTERVAL,
    retry: false,
    staleTime: REFRESH_INTERVAL,
  });

export const useWorkspace = (repoPath: string, enabled = true) =>
  useQuery({
    enabled: repoPath !== "" && enabled,
    queryFn: () => fetchWorkspace(repoPath),
    queryKey: ["workspace", repoPath],
    refetchInterval: REFRESH_INTERVAL,
    retry: false,
    staleTime: REFRESH_INTERVAL,
  });

export const useCodexIntegration = (repoPath: string) =>
  useQuery({
    enabled: repoPath !== "",
    queryFn: () => fetchCodexIntegration(repoPath),
    queryKey: ["codex-integration", repoPath],
    refetchInterval: CODEX_REFRESH_INTERVAL,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: 500,
    staleTime: CODEX_REFRESH_INTERVAL,
  });

export const useLogs = (
  repoPath: string,
  worktreeId: string | null,
  appGroupName: string | null
) =>
  useQuery({
    enabled: repoPath !== "" && worktreeId !== null && appGroupName !== null,
    queryFn: () => {
      if (!(worktreeId && appGroupName)) {
        throw new Error("No selected App group");
      }
      return fetchLogs(repoPath, worktreeId, appGroupName);
    },
    queryKey: ["logs", repoPath, worktreeId, appGroupName],
    refetchInterval: 2500,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: 500,
  });
