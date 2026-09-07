import { describe, expect, it } from "bun:test";

import {
  clearConfigDraft,
  loadConfigDraft,
  saveConfigDraft,
} from "./config-draft";
import type { ConfigDraftStorage } from "./config-draft";

const createMemoryStorage = (): ConfigDraftStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

describe("configuration drafts", () => {
  it("restores an in-progress slot-free JSON draft verbatim", () => {
    const source = '{"version":1,"appGroups":{}}';
    const draft = '{"version":1,"appGroups":';
    const storage = createMemoryStorage();

    saveConfigDraft("/repo/.branchbase.json", source, draft, storage);

    expect(loadConfigDraft("/repo/.branchbase.json", source, storage)).toBe(
      draft
    );
    clearConfigDraft("/repo/.branchbase.json", storage);
    expect(
      loadConfigDraft("/repo/.branchbase.json", source, storage)
    ).toBeNull();
  });

  it("drops a draft when the source changed outside the editor", () => {
    const storage = createMemoryStorage();
    saveConfigDraft("/repo/.branchbase.json", "source", "draft", storage);

    expect(
      loadConfigDraft("/repo/.branchbase.json", "changed", storage)
    ).toBeNull();
    expect(
      loadConfigDraft("/repo/.branchbase.json", "source", storage)
    ).toBeNull();
  });

  it("ignores malformed stored data", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "branchbase:configuration-draft:/repo/.branchbase.json",
      "{"
    );

    expect(
      loadConfigDraft("/repo/.branchbase.json", "source", storage)
    ).toBeNull();
  });

  it("continues when browser storage is unavailable", () => {
    const unavailableStorage: ConfigDraftStorage = {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      removeItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    };

    expect(
      loadConfigDraft("/repo/.branchbase.json", "source", unavailableStorage)
    ).toBeNull();
    expect(() =>
      saveConfigDraft(
        "/repo/.branchbase.json",
        "source",
        "draft",
        unavailableStorage
      )
    ).not.toThrow();
    expect(() =>
      clearConfigDraft("/repo/.branchbase.json", unavailableStorage)
    ).not.toThrow();
  });
});
