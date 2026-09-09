import { useState } from "react";

import type { WorkspaceSnapshot } from "../controller/workspace-snapshot";
import { fetchWorkspace } from "./api";

export const useRepositoryOpen = (
  onOpened: (path: string, snapshot: WorkspaceSnapshot) => void | Promise<void>,
  initialError: Error | null = null
) => {
  const [requestError, setRequestError] = useState<Error | null>(initialError);
  const [pending, setPending] = useState(false);

  const open = async (path: string) => {
    setPending(true);
    setRequestError(null);
    try {
      const snapshot = await fetchWorkspace(path);
      await onOpened(path, snapshot);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error : new Error("Could not open repository")
      );
    }
    setPending(false);
  };

  return {
    clearError: () => setRequestError(null),
    error: requestError,
    open,
    pending,
  };
};
