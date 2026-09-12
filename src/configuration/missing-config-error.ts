export class MissingWorktreeConfigError extends Error {
  readonly code = "missing_worktree_config";
  readonly configPath: string;

  constructor(configPath: string) {
    super(`Missing worktree environment config: ${configPath}`);
    this.configPath = configPath;
    this.name = "MissingWorktreeConfigError";
  }
}
