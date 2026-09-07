import { BranchBaseApiError } from "./api";

export const missingConfigPath = (error: unknown): string | null =>
  error instanceof BranchBaseApiError &&
  error.code === "missing_worktree_config"
    ? error.configPath
    : null;
