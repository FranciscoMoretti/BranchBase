import { ArrowRightIcon, Clock3Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { QueryContent } from "./async-state";
import { hrefFor, useActivity } from "./data";
import { Blank, PageHeading, Search, Status } from "./primitives";

function activityStatus(severity: string): string {
  if (severity === "warning") {
    return "partial";
  }
  return severity === "success" ? "running" : "stopped";
}

export function ActivityPage({
  repoPath,
  groupId,
  worktreeId,
}: {
  repoPath?: string;
  groupId?: string;
  worktreeId?: string;
}) {
  const activity = useActivity(repoPath);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [period, setPeriod] = useState("all");
  const [worktree, setWorktree] = useState("all");
  const worktrees = [
    ...new Map(
      (activity.data ?? [])
        .filter((event) => event.worktreeId)
        .map((event) => [
          event.worktreeId ?? "",
          event.worktreeName ?? event.worktreeId ?? "",
        ])
    ).entries(),
  ];
  const since =
    period === "all" ? 0 : Date.now() - (period === "day" ? 1 : 7) * 86_400_000;
  const [kind, setKind] = useState("all");
  const events = (activity.data ?? []).filter(
    (event) =>
      (!groupId || event.groupId === groupId) &&
      (!worktreeId || event.worktreeId === worktreeId) &&
      (worktree === "all" || event.worktreeId === worktree) &&
      new Date(event.at).getTime() >= since &&
      (kind === "all" || event.kind === kind) &&
      `${event.message} ${event.worktreeName ?? ""} ${event.repoPath}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  return (
    <>
      <PageHeading
        description="Starts, stops, failures, and changes across your worktrees."
        title="Activity"
      />

      <div className="product-filterbar">
        <Search
          onChange={setSearch}
          placeholder="Search activity…"
          value={search}
        />
        <div className="product-select-label">
          Events
          <Select
            onValueChange={(value) => setKind(value ?? "all")}
            value={kind}
          >
            <SelectTrigger aria-label="Event type">
              <SelectValue>
                {
                  (
                    {
                      all: "All events",
                      command: "Commands",
                      configuration: "Configuration",
                      discovery: "Discoveries",
                      runtime: "Runtime",
                    } as Record<string, string>
                  )[kind]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="command">Commands</SelectItem>
              <SelectItem value="runtime">Runtime</SelectItem>
              <SelectItem value="discovery">Discoveries</SelectItem>
              <SelectItem value="configuration">Configuration</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select
          onValueChange={(value) => setPeriod(value ?? "all")}
          value={period}
        >
          <SelectTrigger aria-label="Time range">
            <SelectValue>
              {
                (
                  {
                    all: "All time",
                    day: "Last 24 hours",
                    week: "Last 7 days",
                  } as Record<string, string>
                )[period]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="day">Last 24 hours</SelectItem>
            <SelectItem value="week">Last 7 days</SelectItem>
          </SelectContent>
        </Select>
        {worktreeId ? null : (
          <Select
            onValueChange={(value) => setWorktree(value ?? "all")}
            value={worktree}
          >
            <SelectTrigger aria-label="Worktree">
              <SelectValue>
                {worktree === "all"
                  ? "All worktrees"
                  : (worktrees.find(([id]) => id === worktree)?.[1] ??
                    "Worktree")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All worktrees</SelectItem>
              {worktrees.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="product-muted">Latest 2,000 events retained</span>
      </div>
      <QueryContent label="Activity" query={activity}>
        <div className="product-event-list">
          {events.slice(0, limit).map((event) => (
            <article className="product-event" key={event.id}>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleString(undefined, {
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  month: "short",
                })}
              </time>
              <Clock3Icon />
              <div>
                <strong>{event.message}</strong>
                <p className="product-muted">
                  {event.worktreeName ?? event.repoPath}
                  {event.groupId ? ` · ${event.groupId}` : ""}
                </p>
              </div>
              <Status
                label={event.kind}
                value={activityStatus(event.severity)}
              />
              {event.worktreeId ? (
                <a
                  className="product-link"
                  href={hrefFor({
                    group: event.groupId,
                    repo: event.repoPath,
                    worktree: event.worktreeId,
                  })}
                >
                  Inspect
                  <ArrowRightIcon />
                </a>
              ) : (
                <a
                  className="product-link"
                  href={hrefFor({ repo: event.repoPath })}
                >
                  Open project
                  <ArrowRightIcon />
                </a>
              )}
            </article>
          ))}
        </div>
        {events.length === 0 ? (
          <Blank
            description="New operations and observed runtime changes will appear here."
            title={"No matching activity"}
          />
        ) : null}
        {events.length > limit ? (
          <Button onClick={() => setLimit(limit + 50)} variant="ghost">
            Load earlier activity
          </Button>
        ) : null}
      </QueryContent>
    </>
  );
}
