import { useState } from "react";

import { pickRepository } from "./api";

type PickHandler = (path: string) => void | Promise<void>;

export const useRepositoryPicker = (onPick?: PickHandler) => {
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleBrowse = async (handler = onPick) => {
    try {
      setPending(true);
      setPickerError(null);
      const path = await pickRepository();
      if (path && handler) {
        await handler(path);
      }
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : "Could not open picker"
      );
      // oxlint-disable-next-line react/todo -- React Compiler currently cannot lower try/finally in this hook.
    } finally {
      setPending(false);
    }
  };

  return {
    clearError: () => setPickerError(null),
    error: pickerError,
    handleBrowse,
    pending,
  };
};
