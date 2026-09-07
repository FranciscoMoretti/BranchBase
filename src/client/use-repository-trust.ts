import { useCallback, useState } from "react";

import type { RepositoryTrustApproval } from "../config/repository-trust-approval";

export type RepositoryTrustAction = () => void | Promise<void>;

export interface RepositoryTrustScope {
  approvals: RepositoryTrustApproval[];
  commands: string[];
  trusted: boolean;
}

export type RequestRepositoryTrust = (
  label: string,
  action: RepositoryTrustAction,
  scope?: RepositoryTrustScope
) => void;

interface TrustRequest {
  action: RepositoryTrustAction;
  approvals: RepositoryTrustApproval[];
  commands: string[];
  key: string;
  label: string;
  trusted: boolean;
}

export const repositoryTrustDialogOpen = (
  required: boolean,
  trusted: boolean,
  hasRequest: boolean
): boolean => required && !trusted && hasRequest;

export const useRepositoryTrust = ({
  approval,
  commands,
  repoPath,
  required,
  trusted,
}: {
  approval: RepositoryTrustApproval;
  commands: string[];
  repoPath: string;
  required: boolean;
  trusted: boolean;
}) => {
  const [request, setRequest] = useState<TrustRequest | null>(null);
  const key = repoPath;
  const currentRequest = request?.key === key ? request : null;
  const activeTrusted = currentRequest?.trusted ?? trusted;
  const open = repositoryTrustDialogOpen(
    required,
    activeTrusted,
    currentRequest !== null
  );

  const requestTrust = useCallback<RequestRepositoryTrust>(
    (label, action, scope) => {
      const requestTrusted = scope?.trusted ?? trusted;
      if (!(required && !requestTrusted)) {
        Promise.resolve()
          .then(action)
          .catch(() => undefined);
        return;
      }
      setRequest({
        action,
        approvals: scope?.approvals ?? [approval],
        commands: scope?.commands ?? commands,
        key,
        label,
        trusted: requestTrusted,
      });
    },
    [approval, commands, key, required, trusted]
  );

  const handleDismiss = useCallback(() => {
    setRequest(null);
  }, []);

  const approve = useCallback(
    async (authorize: () => Promise<unknown>) => {
      const action = currentRequest?.action ?? null;
      try {
        await authorize();
      } catch {
        return;
      }
      setRequest(null);
      try {
        await action?.();
      } catch {
        // The command mutation owns its error state and presentation.
      }
    },
    [currentRequest]
  );

  return {
    actionLabel: currentRequest?.label ?? null,
    approvals: currentRequest?.approvals ?? [approval],
    approve,
    commands: currentRequest?.commands ?? commands,
    handleDismiss,
    open,
    requestTrust,
  };
};
