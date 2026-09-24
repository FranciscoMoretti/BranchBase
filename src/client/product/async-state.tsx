import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Disclosure } from "../components/ui/disclosure";
import { Skeleton } from "../components/ui/skeleton";
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
  const toastId = useId();
  const dismissed = useRef<Error | null>(null);
  useEffect(() => {
    if (!error) {
      dismissed.current = null;
      return;
    }
    if (dismissed.current === error) {
      return;
    }
    toast.error(title, {
      closeButton: true,
      description: (
        <>
          <p>{errorDescription(error, true)}</p>
          <ErrorDetails error={error} />
        </>
      ),
      duration: Number.POSITIVE_INFINITY,
      id: toastId,
      onDismiss: () => {
        dismissed.current = error;
      },
    });
    return () => {
      toast.dismiss(toastId);
    };
  }, [error, title, toastId]);
  return null;
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
      <Alert variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{errorDescription(error, true)}</AlertDescription>
      </Alert>
    ) : null}
  </div>
);

const QueryPlaceholder = ({
  query,
  label,
}: {
  query: QueryState;
  label: string;
}) => {
  if (query.error) {
    return (
      <Alert className="product-unavailable" variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>
          {isConnectionError(query.error)
            ? "Can't connect to BranchBase"
            : `Couldn't load ${label.toLowerCase()}`}
        </AlertTitle>
        <AlertDescription>{errorDescription(query.error)}</AlertDescription>
        <Button
          disabled={query.isFetching}
          onClick={() => query.refetch()}
          variant="outline"
        >
          <RefreshCwIcon data-icon="inline-start" />
          {query.isFetching ? "Retrying…" : "Try again"}
        </Button>
        <ErrorDetails error={query.error} />
      </Alert>
    );
  }
  return (
    <div className="product-loading">
      <output className="sr-only">Loading {label.toLowerCase()}</output>
      {[0, 1, 2].map((row) => (
        <div aria-hidden="true" className="product-skeleton-row" key={row}>
          <Skeleton className="size-7 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-2.5 w-1/3 min-w-25" />
            <Skeleton className="h-2.5 w-1/2 min-w-25" />
          </div>
          <Skeleton className="h-6 w-18 shrink-0" />
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
