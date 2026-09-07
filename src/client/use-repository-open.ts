import { useState } from "react";

import type { WorkspaceSnapshot } from "../controller/workspace-snapshot";
import { fetchWorkspace } from "./api";

export const useRepositoryOpen = (
  onOpened: (path: string, snapshot: WorkspaceSnapshot) => void | Promise<void>,
  initialError: Error | null = null
) => {
  const [error, setError] = useState<Error | null>(initialError);
  const [pending, setPending] = useState(false);

  const open = async (path: string) => {
    try {
      setPending(true);
      setError(null);
      const snapshot = await fetchWorkspace(path);
      await onOpened(path, snapshot);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught
          : new Error("Could not open repository")
      );
      // oxlint-disable-next-line react/todo -- React Compiler currently cannot lower try/finally in this hook.
    } finally {
      setPending(false);
    }
  };

  return { clearError: () => setError(null), error, open, pending };
};
