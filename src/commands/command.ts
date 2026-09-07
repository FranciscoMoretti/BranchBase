export const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
};

export const optionalStringArray = (value: unknown): string[] | null => {
  if (value === undefined) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error("Worktree list must contain valid identifiers");
  }
  return value.map((item) => item.trim());
};

export const selectRequestedWorktrees = <T extends { id: string }>(
  worktrees: readonly T[],
  value: unknown
): T[] => {
  const ids = optionalStringArray(value);
  if (ids === null) {
    return [...worktrees];
  }
  const requested = new Set(ids);
  return worktrees.filter((worktree) => requested.has(worktree.id));
};
