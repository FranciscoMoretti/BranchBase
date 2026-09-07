import type { ReactNode } from "react";
import { useState } from "react";

import { RepositoryInitializeDialog } from "./components/repository-initialize-dialog";
import { RepositorySetupNotice } from "./components/repository-setup-notice";
import { missingConfigPath } from "./repository-open-state";

export const useRepositorySetup = ({
  error,
  onCreated,
  repoPath,
}: {
  error: Error | null;
  onCreated: () => void | Promise<void>;
  repoPath: string;
}) => {
  const [open, setOpen] = useState(false);
  const configPath = missingConfigPath(error);
  const notice = (): ReactNode =>
    configPath ? (
      <RepositorySetupNotice
        configPath={configPath}
        onInitialize={() => setOpen(true)}
      />
    ) : null;
  const dialog = open ? (
    <RepositoryInitializeDialog
      onClose={() => setOpen(false)}
      onCreated={async () => {
        setOpen(false);
        await onCreated();
      }}
      repoPath={repoPath}
    />
  ) : null;
  return { active: configPath !== null, dialog, notice };
};
