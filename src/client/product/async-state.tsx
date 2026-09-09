import { AlertCircleIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

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
  resetKey?: string;
}

export const ErrorDetails = ({ error }: { error: Error }) => (
  <Disclosure className="product-error-details" summary="Technical details">
    <pre>{error.message}</pre>
  </Disclosure>
);

/** Command errors never reflow the page and never automatically replay an action. */
export const ActionFeedback = ({
  error,
  title = "Action couldn't be completed",
}: {
  error?: Error | null;
  title?: string;
}) => {
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
};

/** Reserved form feedback space keeps submit/cancel controls in place. */
export const FormFeedback = ({
  error,
  title = "Action couldn't be completed",
}: {
  error?: Error | null;
  title?: string;
}) => (
  <div aria-live="polite" className="product-form-feedback">
    {error ? (
      <div role="alert">
        <strong>{title}</strong>
        <p>{errorDescription(error, true)}</p>
      </div>
    ) : null}
  </div>
);

const QueryProgress = ({
  query,
  label,
}: {
  query: QueryState;
  label: string;
}) => {
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
};
const QueryPlaceholder = ({
  query,
  label,
}: {
  query: QueryState;
  label: string;
}) => {
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
    <div className="product-loading">
      <output className="sr-only">Loading {label.toLowerCase()}</output>
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
};
export const QueryContent = ({
  query,
  label,
  children,
  compact = false,
  resetKey,
}: {
  query: QueryState;
  label: string;
  children: ReactNode;
  compact?: boolean;
  resetKey?: string;
}) => {
  const hasData = query.data !== undefined;
  const [rememberedFailure, setRememberedFailure] = useState<{
    error: Error;
    key?: string;
  } | null>(null);
  const [previous, setPrevious] = useState(() => ({
    data: query.data,
    error: query.error,
    resetKey,
  }));
  if (
    previous.data !== query.data ||
    previous.error !== query.error ||
    previous.resetKey !== resetKey
  ) {
    setPrevious({ data: query.data, error: query.error, resetKey });
    if (query.error) {
      setRememberedFailure({ error: query.error, key: resetKey });
    } else if (query.data !== undefined || previous.resetKey !== resetKey) {
      setRememberedFailure(null);
    } else if (previous.error) {
      setRememberedFailure({ error: previous.error, key: resetKey });
    }
  }
  // TanStack clears an initial error while retrying. Keep the recovery panel in
  // place until data arrives by remembering the error before the query state
  // clears during a retry.
  const displayedFailure =
    rememberedFailure && rememberedFailure.key === resetKey
      ? rememberedFailure.error
      : null;
  const displayed = hasData
    ? query
    : {
        ...query,
        error: query.error ?? displayedFailure,
      };
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
};
