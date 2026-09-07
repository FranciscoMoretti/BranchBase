const REPOSITORY_QUERY_PARAM = "repo";
const REPOSITORY_PAGE_QUERY_PARAM = "view";

export type RepositoryPage = "settings" | "workspace";

export const repositoryPathFromSearch = (search: string): string | null => {
  const value = new URLSearchParams(search).get(REPOSITORY_QUERY_PARAM)?.trim();
  return value || null;
};

export const repositoryPageFromSearch = (search: string): RepositoryPage =>
  new URLSearchParams(search).get(REPOSITORY_PAGE_QUERY_PARAM) === "settings"
    ? "settings"
    : "workspace";

export const repositoryUrl = (
  baseUrl: string,
  repoPath?: string | null,
  page: RepositoryPage = "workspace"
) => {
  const url = new URL(baseUrl);
  if (repoPath) {
    url.searchParams.set(REPOSITORY_QUERY_PARAM, repoPath);
  } else {
    url.searchParams.delete(REPOSITORY_QUERY_PARAM);
  }
  if (page === "settings") {
    url.searchParams.set(REPOSITORY_PAGE_QUERY_PARAM, "settings");
  } else {
    url.searchParams.delete(REPOSITORY_PAGE_QUERY_PARAM);
  }
  return url.toString();
};

export const repositoryPathFromArgs = (
  args: readonly string[],
  invocationDirectory?: string
): string | null => {
  let value = invocationDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--repo") {
      value = args[index + 1];
      index += 1;
    } else if (argument?.startsWith("--repo=")) {
      value = argument.slice("--repo=".length);
    }
  }
  return value?.trim() || null;
};
