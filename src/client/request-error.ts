const CONNECTION_MESSAGE =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection to branchbase is unavailable|connection_unavailable/iu;
export const isConnectionError = (error: Error): boolean =>
  error.name === "TimeoutError" ||
  error.name === "AbortError" ||
  CONNECTION_MESSAGE.test(error.message) ||
  ("code" in error && error.code === "CONNECTION_UNAVAILABLE");
export const errorDescription = (error: Error, action = false): string => {
  if (isConnectionError(error)) {
    return action
      ? "The connection was interrupted. The action may have completed. Refresh the view before trying again."
      : "Couldn't reach the local BranchBase service. It may be restarting or unavailable. Retry when it is running.";
  }
  if (
    error.name === "ZodError" ||
    error.name === "SyntaxError" ||
    ("code" in error && error.code === "INVALID_RESPONSE")
  ) {
    return "BranchBase returned an unreadable response. Retry, or reload the page if the service was updated.";
  }
  return (
    error.message ||
    "Something went wrong. Try again; your current view has been kept."
  );
};
