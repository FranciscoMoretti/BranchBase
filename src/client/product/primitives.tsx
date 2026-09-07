import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  GitForkIcon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { AppEndpointSnapshot } from "../../controller/workspace-snapshot";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { ActionFeedback } from "./async-state";
import { hrefFor } from "./data";
import type { ProductLocation, ProductView } from "./data";

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
  <span className="product-status" data-status={value}>
    <span aria-hidden="true" />
    {label ?? value.charAt(0).toUpperCase() + value.slice(1)}
  </span>
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
        {{ failed: "Clipboard unavailable", copied: "Copied", idle: "" }[state]}
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
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) => (
  <div className="product-page-heading">
    <div>
      <h1>{title}</h1>
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
}) => (
  <Input
    aria-label={placeholder}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    type="search"
    value={value}
  />
);
export const Shell = ({
  location,
  name,
  children,
}: {
  location: ProductLocation;
  name?: string;
  children: ReactNode;
}) => {
  const tabs: [ProductView, string][] = [
    ["workspace", "Environments"],
    ["infrastructure", "Infrastructure"],
    ["activity", "Activity"],
    ["settings", "Settings"],
  ];
  return (
    <div className="product-shell">
      <header className="product-header">
        <a className="product-brand" href="/">
          <GitForkIcon />
          BranchBase
        </a>
        <span className="product-breadcrumb-divider">/</span>
        {location.repo && location.view !== "machine" ? (
          <a className="product-crumb" href={hrefFor({ repo: location.repo })}>
            {name ?? "Project"}
          </a>
        ) : (
          <span>{location.view === "machine" ? "Settings" : "Projects"}</span>
        )}
        <a
          aria-current={location.view === "machine" ? "page" : undefined}
          aria-label="BranchBase settings"
          className="product-global-settings"
          href={hrefFor({ view: "machine" })}
        >
          <SettingsIcon />
          Settings
        </a>
      </header>
      {location.repo && location.view !== "machine" ? (
        <nav aria-label="Project" className="product-tabs">
          {tabs.map(([view, label]) => (
            <a
              aria-current={location.view === view ? "page" : undefined}
              href={hrefFor({ repo: location.repo, view })}
              key={view}
            >
              {label}
            </a>
          ))}
        </nav>
      ) : null}
      <main className="product-content">{children}</main>
    </div>
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
