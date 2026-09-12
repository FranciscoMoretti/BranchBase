export type AppGroupLifecycleErrorCode =
  | "endpoint-ownership-conflict"
  | "invalid-run-state"
  | "not-started"
  | "port-occupied"
  | "readiness-failed"
  | "routing-unavailable"
  | "route-conflict"
  | "route-publication-failed"
  | "start-failed"
  | "stop-failed";

export class AppGroupLifecycleError extends Error {
  readonly code: AppGroupLifecycleErrorCode;

  constructor(code: AppGroupLifecycleErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AppGroupLifecycleError";
  }
}
