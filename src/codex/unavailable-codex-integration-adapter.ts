import type {
  CodexIntegrationAdapter,
  CodexIntegrationAdapterSnapshot,
  CodexWorktreeReference,
} from "./codex-integration";
import { CodexIntegrationUnavailableError } from "./codex-integration-error";

const closeUnavailable = (): Promise<void> => Promise.resolve();

const loadUnavailable = (
  _worktrees: readonly CodexWorktreeReference[]
): Promise<CodexIntegrationAdapterSnapshot> =>
  Promise.reject(new CodexIntegrationUnavailableError());

export const createUnavailableCodexIntegrationAdapter =
  (): CodexIntegrationAdapter => ({
    close: closeUnavailable,
    loadAssociatedTasks: loadUnavailable,
  });
