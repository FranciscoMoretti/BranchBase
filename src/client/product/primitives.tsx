import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { AppEndpointSnapshot } from "../../project/worktree-status-contract";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { ActionFeedback } from "./async-state";

export const ErrorNotice = ({
  error,
  title,
}: {
  error: Error | null | undefined;
  title?: string;
}) => <ActionFeedback error={error} title={title} />;
export const Blank = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {children}
  </Empty>
);
export const Status = ({ value, label }: { value: string; label?: string }) => (
  <Badge className="product-status" data-status={value} variant="outline">
    <span aria-hidden="true" />
    {label ?? value.charAt(0).toUpperCase() + value.slice(1)}
  </Badge>
);
export const CopyButton = ({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) => {
  const [state, setState] = useState("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );
  return (
    <Button
      aria-label={label}
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setState("idle"), 1800);
      }}
      size="icon-sm"
      title={label}
      variant="ghost"
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {{ copied: "Copied", failed: "Clipboard unavailable", idle: "" }[state]}
      </span>
    </Button>
  );
};
export const AppLink = ({
  app,
  name = true,
}: {
  app: AppEndpointSnapshot;
  name?: boolean;
}) => {
  if (app.open && app.url) {
    return (
      <a
        className="product-link"
        href={app.url}
        rel="noreferrer"
        target="_blank"
      >
        {name ? app.label : "Open"}
        <ArrowUpRightIcon />
      </a>
    );
  }
  if (app.readiness === "ready" && app.directUrl) {
    return (
      <span className="inline-flex items-center gap-1">
        {name ? app.label : app.directUrl}
        <CopyButton
          label={`Copy ${app.label} connection`}
          value={app.directUrl}
        />
      </span>
    );
  }
  return (
    <span className="product-muted">{name ? app.label : "Unavailable"}</span>
  );
};
export const PageHeading = ({
  title,
  description,
  children,
  level = 1,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  level?: 1 | 2;
}) => (
  <div className="product-page-heading">
    <div>
      {level === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description ? <p>{description}</p> : null}
    </div>
    <div className="product-actions">{children}</div>
  </div>
);
export const Search = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => {
  const id = useId();
  return (
    <InputGroup className="product-search">
      <InputGroupAddon htmlFor={id}>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </InputGroup>
  );
};
export const countLabel = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

export const ResourceUsage = ({
  usage,
}: {
  usage?: {
    memoryBytes: number;
    cpuPercent: number;
    processCount: number;
  } | null;
}) => {
  if (!usage || usage.processCount === 0) {
    return null;
  }
  const memory =
    usage.memoryBytes >= 1024 ** 3
      ? `${(usage.memoryBytes / 1024 ** 3).toFixed(1)} GB`
      : `${Math.round(usage.memoryBytes / 1024 ** 2)} MB`;
  return (
    <span
      className="product-muted product-resource-usage"
      title="Observed CPU and resident memory of associated processes and their descendants. CPU can exceed 100% across cores."
    >
      {memory} · {usage.cpuPercent.toFixed(1)}% CPU
    </span>
  );
};
