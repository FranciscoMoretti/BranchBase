export class CodexIntegrationUnavailableError extends Error {
  readonly code = "codex_integration_unavailable";

  constructor(message = "Codex task discovery is unavailable") {
    super(message);
    this.name = "CodexIntegrationUnavailableError";
  }
}
