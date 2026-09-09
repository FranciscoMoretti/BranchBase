import { useState } from "react";

import { pickRepository } from "./api";

type PickHandler = (path: string) => void | Promise<void>;

export const useRepositoryPicker = (onPick?: PickHandler) => {
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleBrowse = async (handler = onPick) => {
    setPending(true);
    setPickerError(null);
    try {
      const path = await pickRepository();
      if (path && handler) {
        await handler(path);
      }
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : "Could not open picker"
      );
    }
    setPending(false);
  };

  return {
    clearError: () => setPickerError(null),
    error: pickerError,
    handleBrowse,
    pending,
  };
};
