import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  FoldersResponseSchema,
  ObservationSchema,
} from "../../controller/discovery-contract";
import {
  ActivityResponseSchema,
  ProjectsResponseSchema,
} from "../../controller/product-contract";
import { getJson, runCommand } from "../api";

export function useObservation(repoPath: string) {
  return useQuery({
    enabled: Boolean(repoPath),
    queryFn: async () =>
      ObservationSchema.parse(
        await getJson(`/api/observation?${new URLSearchParams({ repoPath })}`)
      ),
    queryKey: ["observation", repoPath],
    refetchInterval: 5000,
    retry: 1,
  });
}
export function useDevelopmentFolders() {
  return useQuery({
    queryFn: async () =>
      FoldersResponseSchema.parse(await getJson("/api/development-folders"))
        .folders,
    queryKey: ["development-folders"],
    refetchInterval: 30_000,
    retry: 1,
  });
}
export function useProjects(poll = true) {
  return useQuery({
    queryFn: async () =>
      ProjectsResponseSchema.parse(await getJson("/api/projects")).projects,
    queryKey: ["projects"],
    refetchInterval: poll ? 5000 : false,
    retry: 1,
    retryDelay: 750,
  });
}
export function useActivity(repoPath?: string) {
  return useQuery({
    queryFn: async () =>
      ActivityResponseSchema.parse(
        await getJson(
          `/api/activity?${new URLSearchParams(repoPath ? { repoPath } : {})}`
        )
      ).events,
    queryKey: ["activity", repoPath ?? "all"],
    refetchInterval: 5000,
    retry: 1,
    retryDelay: 750,
  });
}
export function useProductCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      command,
      ...input
    }: {
      command: string;
      [key: string]: unknown;
    }) => runCommand(command, input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["projects"] }),
        client.invalidateQueries({ queryKey: ["observation"] }),
        client.invalidateQueries({ queryKey: ["development-folders"] }),
        client.invalidateQueries({ queryKey: ["workspace"] }),
        client.invalidateQueries({ queryKey: ["activity"] }),
      ]),
  });
}
export type ProductView =
  | "workspace"
  | "infrastructure"
  | "activity"
  | "settings"
  | "machine";
export interface ProductLocation {
  group: string;
  panel: string;
  repo: string;
  section: string;
  view: ProductView;
  worktree: string;
}
export function readLocation(): ProductLocation {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? params.get("page");
  return {
    group: params.get("group") ?? "",
    panel: ["logs", "activity", "configuration", "tasks"].includes(
      params.get("panel") ?? ""
    )
      ? (params.get("panel") ?? "logs")
      : "logs",
    repo: params.get("repo") ?? "",
    section: [
      "general",
      "configuration",
      "command trust",
      "integrations",
    ].includes(params.get("section") ?? "")
      ? (params.get("section") ?? "general")
      : "general",
    view:
      view === "infrastructure" ||
      view === "activity" ||
      view === "settings" ||
      view === "machine"
        ? view
        : "workspace",
    worktree: params.get("worktree") ?? "",
  };
}
export function hrefFor(location: Partial<ProductLocation>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(location)) {
    if (value && !(key === "view" && value === "workspace")) {
      params.set(key, value);
    }
  }
  return `/?${params}`;
}
