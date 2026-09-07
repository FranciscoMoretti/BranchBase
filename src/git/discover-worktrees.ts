const LINE_BREAK = /\r?\n/;

export interface DiscoveredWorktree {
  branch: string | null;
  head: string | null;
  path: string;
  prunable: boolean;
}

export const parseWorktreeList = (output: string): DiscoveredWorktree[] => {
  const worktrees: DiscoveredWorktree[] = [];
  let current: DiscoveredWorktree | null = null;

  for (const line of output.split(LINE_BREAK)) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(current);
      }
      current = {
        branch: null,
        head: null,
        path: line.slice("worktree ".length),
        prunable: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  if (current) {
    worktrees.push(current);
  }
  return worktrees;
};
