const MAX_CODEX_TASK_ID_LENGTH = 512;
const MAX_WORKTREE_PATH_LENGTH = 4096;
const UNESCAPED_RFC_3986_CHARACTERS = /[!'()*]/g;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function encodeLinkValue(value: string, maxLength: number): string | null {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacter(value)
  ) {
    return null;
  }
  try {
    return encodeURIComponent(value).replace(
      UNESCAPED_RFC_3986_CHARACTERS,
      (character) => {
        const codePoint = character.codePointAt(0);
        return codePoint === undefined
          ? character
          : `%${codePoint.toString(16).toUpperCase()}`;
      }
    );
  } catch {
    return null;
  }
}

export function codexOpenTaskUrl(taskId: string): string | null {
  if (taskId.trim() !== taskId) {
    return null;
  }
  const encodedTaskId = encodeLinkValue(taskId, MAX_CODEX_TASK_ID_LENGTH);
  return encodedTaskId === null ? null : `codex://threads/${encodedTaskId}`;
}

export function codexNewTaskUrl(canonicalWorktreePath: string): string | null {
  if (canonicalWorktreePath.trim().length === 0) {
    return null;
  }
  const encodedPath = encodeLinkValue(
    canonicalWorktreePath,
    MAX_WORKTREE_PATH_LENGTH
  );
  return encodedPath === null ? null : `codex://new?path=${encodedPath}`;
}
