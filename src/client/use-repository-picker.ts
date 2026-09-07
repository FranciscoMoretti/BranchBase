import { useState } from "react";

import { pickRepository } from "./api";

type PickHandler = (path: string) => void | Promise<void>;

export const useRepositoryPicker = (onPick?: PickHandler) => {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleBrowse = async (handler = onPick) => {
    try {
      setPending(true);
      setError(null);
      const path = await pickRepository();
      if (path && handler) {
        await handler(path);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open picker"
      );
      // oxlint-disable-next-line react/todo -- React Compiler currently cannot lower try/finally in this hook.
    } finally {
      setPending(false);
    }
  };

  return {
    clearError: () => setError(null),
    error,
    handleBrowse,
    pending,
  };
};
