import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BranchBaseCommandName,
  BranchBaseCommandInput,
} from "../../application/command-contract";
import {
  ActivityResponseSchema,
  ProjectsResponseSchema,
} from "../../project/catalog-contract";
import {
  FoldersResponseSchema,
  ObservationSchema,
} from "../../project/discovery-contract";
import { getJson, runCommand } from "../api";
import { invalidateCommandQueries } from "../command-invalidation";

export const useObservation = (repoPath: string) =>
  useQuery({
    enabled: Boolean(repoPath),
    queryFn: async () =>
      ObservationSchema.parse(
        await getJson(`/api/observation?${new URLSearchParams({ repoPath })}`)
      ),
    queryKey: ["observation", repoPath],
    refetchInterval: 5000,
    retry: 1,
  });
export const useDevelopmentFolders = () =>
  useQuery({
    queryFn: async () =>
      FoldersResponseSchema.parse(await getJson("/api/development-folders"))
        .folders,
    queryKey: ["development-folders"],
    refetchInterval: 30_000,
    retry: 1,
  });
export const useProjects = (poll = true) =>
  useQuery({
    queryFn: async () =>
      ProjectsResponseSchema.parse(await getJson("/api/projects")).projects,
    queryKey: ["projects"],
    refetchInterval: poll ? 5000 : false,
    retry: 1,
    retryDelay: 750,
  });
export const useActivity = (repoPath?: string) =>
  useQuery({
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
export type ProductCommandInput = {
  [Name in BranchBaseCommandName]: {
    command: Name;
  } & BranchBaseCommandInput<Name>;
}[BranchBaseCommandName];

export const useProductCommand = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ command, ...input }: ProductCommandInput) =>
      runCommand(command, input),
    onSettled: (_result, _error, { command, ...input }) =>
      invalidateCommandQueries(client, command, input),
  });
};
export { hrefFor, readLocation } from "./location";
export type { ProductLocation, ProductRoute, ProductView } from "./location";
