import { useQuery } from "@tanstack/react-query";

import { fetchCodexIntegration, fetchLogs, fetchWorkspace } from "./api";

export const REFRESH_INTERVAL = 5000;
const CODEX_REFRESH_INTERVAL = 2500;

export function useWorkspace(repoPath: string, enabled = true) {
  return useQuery({
    enabled: repoPath !== "" && enabled,
    queryFn: () => fetchWorkspace(repoPath),
    queryKey: ["workspace", repoPath],
    refetchInterval: REFRESH_INTERVAL,
    retry: false,
    staleTime: REFRESH_INTERVAL,
  });
}

export function useCodexIntegration(repoPath: string) {
  return useQuery({
    enabled: repoPath !== "",
    queryFn: () => fetchCodexIntegration(repoPath),
    queryKey: ["codex-integration", repoPath],
    refetchInterval: CODEX_REFRESH_INTERVAL,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: 500,
    staleTime: CODEX_REFRESH_INTERVAL,
  });
}

export function useLogs(
  repoPath: string,
  worktreeId: string | null,
  appGroupName: string | null
) {
  return useQuery({
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
}
