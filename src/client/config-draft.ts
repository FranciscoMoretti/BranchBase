import { z } from "zod";

const CONFIG_DRAFT_STORAGE_PREFIX = "branchbase:configuration-draft:";

export interface ConfigDraftStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

const StoredConfigDraftSchema = z.strictObject({
  draft: z.string(),
  source: z.string(),
});
type StoredConfigDraft = z.infer<typeof StoredConfigDraftSchema>;

function configDraftStorageKey(configPath: string): string {
  return `${CONFIG_DRAFT_STORAGE_PREFIX}${configPath}`;
}

export function loadConfigDraft(
  configPath: string,
  source: string,
  storage: ConfigDraftStorage | undefined = globalThis.sessionStorage
): string | null {
  if (!storage) {
    return null;
  }
  const key = configDraftStorageKey(configPath);
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const stored = StoredConfigDraftSchema.parse(JSON.parse(raw));
    if (stored.source !== source) {
      storage.removeItem(key);
      return null;
    }
    return stored.draft;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return null;
  }
}

export function saveConfigDraft(
  configPath: string,
  source: string,
  draft: string,
  storage: ConfigDraftStorage | undefined = globalThis.sessionStorage
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      configDraftStorageKey(configPath),
      JSON.stringify({
        draft,
        source,
      } satisfies StoredConfigDraft)
    );
  } catch {
    // The close guards still protect the draft when storage is unavailable.
  }
}

export function clearConfigDraft(
  configPath: string,
  storage: ConfigDraftStorage | undefined = globalThis.sessionStorage
): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(configDraftStorageKey(configPath));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}
