import type {
  CodexIntegrationAdapter,
  CodexIntegrationAdapterSnapshot,
  CodexWorktreeReference,
} from "./codex-integration";
import { CodexIntegrationUnavailableError } from "./codex-integration-error";

export class UnavailableCodexIntegrationAdapter implements CodexIntegrationAdapter {
  // oxlint-disable-next-line eslint/class-methods-use-this -- This adapter intentionally has no state.
  readonly close = (): Promise<void> => Promise.resolve();

  // oxlint-disable-next-line eslint/class-methods-use-this -- This adapter intentionally has no state.
  readonly loadAssociatedTasks = (
    _worktrees: readonly CodexWorktreeReference[]
  ): Promise<CodexIntegrationAdapterSnapshot> =>
    Promise.reject(new CodexIntegrationUnavailableError());
}
