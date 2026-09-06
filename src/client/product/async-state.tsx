import { AlertCircleIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import { errorDescription, isConnectionError } from "../request-error";

export interface QueryState {
  data: unknown;
  dataUpdatedAt?: number;
  error: Error | null;
  isFetching: boolean;
  isPending: boolean;
  refetch: () => unknown;
}

export function ErrorDetails({ error }: { error: Error }) {
  return (
    <Disclosure className="product-error-details" summary="Technical details">
      <pre>{error.message}</pre>
    </Disclosure>
  );
}

/** Command errors never reflow the page and never automatically replay an action. */
export function ActionFeedback({
  error,
  title = "Action couldn't be completed",
}: {
  error?: Error | null;
  title?: string;
}) {
  const [dismissed, setDismissed] = useState<Error | null>(null);
  if (!error || dismissed === error) {
    return null;
  }
  return (
    <aside className="product-action-feedback" role="alert">
      <AlertCircleIcon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{errorDescription(error, true)}</p>
        <ErrorDetails error={error} />
      </div>
      <Button
        aria-label="Dismiss error"
        onClick={() => setDismissed(error)}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </aside>
  );
}

/** Reserved form feedback space keeps submit/cancel controls in place. */
export function FormFeedback({
  error,
  title = "Action couldn't be completed",
}: {
  error?: Error | null;
  title?: string;
}) {
  return (
    <div aria-live="polite" className="product-form-feedback">
      {error ? (
        <div role="alert">
          <strong>{title}</strong>
          <p>{errorDescription(error, true)}</p>
        </div>
      ) : null}
    </div>
  );
}

function QueryProgress({ query, label }: { query: QueryState; label: string }) {
  if (query.data !== undefined && query.error) {
    return (
      <>
        <span className="product-query-warning">
          <AlertCircleIcon aria-hidden="true" />
          Update unavailable · Showing the last successful update
        </span>
        <Button
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          size="sm"
          variant="ghost"
        >
          {query.isFetching ? "Reconnecting…" : "Retry"}
        </Button>
      </>
    );
  }
  if (query.data === undefined && query.error) {
    return null;
  }
  if (query.isFetching) {
    return (
      <span className="product-refreshing">
        <RefreshCwIcon aria-hidden="true" />
        {query.data === undefined
          ? `Loading ${label.toLowerCase()}…`
          : "Updating…"}
      </span>
    );
  }
  return query.dataUpdatedAt ? (
    <span>
      Updated{" "}
      {new Date(query.dataUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  ) : null;
}
function QueryPlaceholder({
  query,
  label,
}: {
  query: QueryState;
  label: string;
}) {
  if (query.error) {
    return (
      <div className="product-unavailable" role="alert">
        <AlertCircleIcon aria-hidden="true" />
        <h2>
          {isConnectionError(query.error)
            ? "Can't connect to BranchBase"
            : `Couldn't load ${label.toLowerCase()}`}
        </h2>
        <p>{errorDescription(query.error)}</p>
        <Button
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          variant="outline"
        >
          <RefreshCwIcon />
          {query.isFetching ? "Retrying…" : "Try again"}
        </Button>
        <ErrorDetails error={query.error} />
      </div>
    );
  }
  return (
    <div className="product-loading" role="status">
      <span className="sr-only">Loading {label.toLowerCase()}</span>
      {[0, 1, 2].map((row) => (
        <div aria-hidden="true" className="product-skeleton-row" key={row}>
          <i />
          <div>
            <i />
            <i />
          </div>
          <i />
        </div>
      ))}
    </div>
  );
}
export function QueryContent({
  query,
  label,
  children,
  compact = false,
}: {
  query: QueryState;
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  const hasData = query.data !== undefined;
  const [lastFailure, setLastFailure] = useState<Error | null>(null);
  useEffect(() => {
    if (query.error) {
      setLastFailure(query.error);
    } else if (query.data !== undefined) {
      setLastFailure(null);
    }
  }, [query.error, query.data]);
  // TanStack clears an initial error while retrying. Keep the recovery panel in
  // place until data arrives instead of swapping it back to skeleton rows.
  const displayed = hasData
    ? query
    : { ...query, error: query.error ?? lastFailure };
  return (
    <section
      aria-label={label}
      className={
        compact
          ? "product-query-region product-query-compact"
          : "product-query-region"
      }
    >
      <div aria-live="polite" className="product-query-status">
        <QueryProgress label={label} query={displayed} />
      </div>
      <div
        aria-busy={!(hasData || displayed.error)}
        className="product-query-body"
      >
        {hasData ? (
          children
        ) : (
          <QueryPlaceholder label={label} query={displayed} />
        )}
      </div>
    </section>
  );
}
