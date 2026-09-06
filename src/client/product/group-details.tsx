import { ArrowLeftIcon, DownloadIcon, PinIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";
import type { ProjectOverview } from "../../controller/product-contract";
import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { AppGroupInstanceControl } from "../components/app-group-instance-control";
import { appGroupDisplayStatus } from "../components/app-group-status";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  CodexTasksSection,
  WorktreeConfigurationSource,
} from "../components/worktree-details";
import { useLogs } from "../queries";
import { ActivityPage } from "./activity-page";
import { QueryContent } from "./async-state";
import { useProductCommand } from "./data";
import { type GroupControls, GroupToggle } from "./environment-list";
import {
  AppLink,
  Blank,
  CopyButton,
  countLabel,
  ErrorNotice,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";

function endpointLabel(app: {
  ownership: string;
  readiness: string;
  listening: boolean;
}): string {
  if (app.ownership === "foreign") {
    return "Foreign listener";
  }
  if (app.readiness === "ready") {
    return "Ready";
  }
  return app.listening ? "Not ready" : "Stopped";
}

export function GroupDetails({
  tab,
  onTabChange,
  repoPath,
  worktree,
  group,
  controls,
  onBack,
  project,
  codex,
  codexError,
  onCreateInstance,
  onSelectInstance,
  onConfigSource,
  onClearLogs,
}: {
  tab: string;
  onTabChange: (value: string) => void;
  repoPath: string;
  worktree: WorktreeSnapshot;
  group: AppGroupSnapshot;
  controls: GroupControls;
  onBack: () => void;
  project?: ProjectOverview;
  codex?: CodexIntegrationSnapshot;
  codexError: boolean;
  onCreateInstance: (name: string) => Promise<void>;
  onSelectInstance: (id: string) => void;
  onConfigSource: (source: "checkout" | "project-default") => void;
  onClearLogs: () => void;
}) {
  const logs = useLogs(repoPath, worktree.id, group.id);
  const save = useProductCommand();
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const logViewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && logs.data && logViewport.current) {
      logViewport.current.scrollTop = logViewport.current.scrollHeight;
    }
  }, [follow, logs.data]);
  const filtered = (logs.data ?? []).filter((line) =>
    line.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
      <Button onClick={onBack} variant="ghost">
        <ArrowLeftIcon />
        Environments
      </Button>
      <PageHeading
        description={`${worktree.branch} · ${countLabel(group.apps.length, "app")}`}
        title={group.name}
      >
        <Status value={appGroupDisplayStatus(group)} />
        <GroupToggle controls={controls} group={group} worktree={worktree} />
        <Button
          disabled={
            controls.blocked(worktree, group) ||
            (!group.processRunning && group.health === "not-running") ||
            group.cleanupOnly
          }
          onClick={() => controls.restart(worktree, group)}
          variant="outline"
        >
          Restart
        </Button>
      </PageHeading>
      <RunContext group={group} onTasks={() => onTabChange("tasks")} />
      <ErrorNotice error={save.error} />
      {appGroupDisplayStatus(group) === "partial" ? (
        <div className="product-row-notice">
          Some apps or routes are not ready. Available apps remain accessible.
          <Button
            disabled={controls.blocked(worktree, group)}
            onClick={() => controls.retry(worktree, group)}
            variant="link"
          >
            Retry readiness and routes
          </Button>
        </div>
      ) : null}
      <div className="product-endpoints">
        <div className="product-endpoint-head">
          <span>App</span>
          <span>Readiness</span>
          <span>Access</span>
          <span>Actions</span>
        </div>
        {group.apps.map((app) => {
          const pin = {
            worktreeId: worktree.id,
            groupId: group.id,
            appId: app.id,
          };
          const pinned = project?.pins.some(
            (item) =>
              item.appId === pin.appId &&
              item.groupId === pin.groupId &&
              item.worktreeId === pin.worktreeId
          );
          return (
            <div className="product-endpoint" key={app.id}>
              <strong>{app.label}</strong>
              <Status
                label={endpointLabel(app)}
                value={app.readiness === "ready" ? "running" : "stopped"}
              />
              <div className="product-endpoint-address">
                <code>
                  {app.url ??
                    app.directUrl ??
                    (app.port ? `127.0.0.1:${app.port}` : "Not allocated")}
                </code>
                {app.protocol === "http" &&
                app.readiness === "ready" &&
                !app.open ? (
                  <span className="product-warning">
                    Route {app.routeState}
                  </span>
                ) : null}
              </div>
              <div className="product-actions">
                <AppLink app={app} name={false} />
                <CopyButton
                  label={`Copy ${app.label} endpoint`}
                  value={app.url ?? app.directUrl ?? String(app.port ?? "")}
                />
                <Button
                  aria-label={`${pinned ? "Unpin" : "Pin"} ${app.label} on Projects`}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({
                      command: "save-project",
                      repoPath,
                      pins: pinned
                        ? project?.pins.filter(
                            (item) =>
                              !(
                                item.appId === pin.appId &&
                                item.groupId === pin.groupId &&
                                item.worktreeId === pin.worktreeId
                              )
                          )
                        : [...(project?.pins ?? []), pin],
                    })
                  }
                  size="icon-sm"
                  title={`${pinned ? "Unpin" : "Pin"} ${app.label} on Projects`}
                  variant={pinned ? "secondary" : "ghost"}
                >
                  <PinIcon />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <nav aria-label="Group details" className="product-tabs product-subtabs">
        {["logs", "activity", "configuration", "tasks"].map((value) => (
          <Button
            aria-pressed={tab === value}
            key={value}
            onClick={() => onTabChange(value)}
            variant="ghost"
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </nav>
      {tab === "logs" ? (
        <>
          <div className="product-filterbar">
            <Search
              onChange={setSearch}
              placeholder="Search managed logs…"
              value={search}
            />
            <label className="product-check" htmlFor="follow-logs">
              <Checkbox
                checked={follow}
                id="follow-logs"
                onCheckedChange={setFollow}
              />
              Follow
            </label>
            <CopyButton label="Copy logs" value={filtered.join("\n")} />
            <Button
              disabled={!filtered.length}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([filtered.join("\n")], { type: "text/plain" })
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "branchbase.log";
                link.click();
                URL.revokeObjectURL(url);
              }}
              size="sm"
              variant="outline"
            >
              <DownloadIcon />
              Download
            </Button>
            <Button
              disabled={controls.blocked(worktree, group)}
              onClick={onClearLogs}
              variant="ghost"
            >
              Clear logs
            </Button>
          </div>
          <QueryContent compact label="Logs" query={logs}>
            <ScrollArea
              className="product-logs"
              scrollbars={["vertical", "horizontal"]}
              viewportRef={logViewport}
            >
              <pre>{filtered.join("\n") || "No matching log output."}</pre>
            </ScrollArea>
          </QueryContent>
        </>
      ) : null}
      {tab === "activity" ? (
        <ActivityPage
          groupId={group.id}
          repoPath={repoPath}
          worktreeId={worktree.id}
        />
      ) : null}
      {tab === "configuration" ? (
        <div className="product-settings-panel">
          <WorktreeConfigurationSource
            disabled={
              worktree.configuration.changeBlocked ||
              controls.blocked(worktree, group)
            }
            onSelect={onConfigSource}
            worktree={worktree}
          />
          <div className="product-setting-row">
            <div>
              <h2>App-group instance</h2>
              <p className="product-muted">
                {group.instance.mode === "selectable"
                  ? "Select an existing instance or create a named alternative."
                  : "This group has its own instance for this worktree."}
              </p>
            </div>
            <AppGroupInstanceControl
              disabled={controls.blocked(worktree, group)}
              group={group}
              onCreate={onCreateInstance}
              onSelect={onSelectInstance}
            />
          </div>
          <Button onClick={() => controls.review(worktree)} variant="outline">
            Review worktree commands
          </Button>
          <pre className="product-command-preview">
            {worktree.configuration.trustCommands.join("\n")}
          </pre>
        </div>
      ) : null}
      {tab === "tasks" ? (
        <CodexTasksSection
          discoveryUnavailable={codexError}
          loading={!(codex || codexError)}
          tasks={codex?.worktrees[worktree.id]?.tasks ?? []}
          worktreePath={worktree.path}
        />
      ) : null}
      {group.dependencies?.length ? (
        <section className="product-settings-panel">
          <h2>Dependencies</h2>
          <p className="product-muted">
            Instances referenced by this group's environment or start command.
          </p>
          {group.dependencies.map((dependency) => {
            const selected = worktree.appGroups.find(
              (item) => item.instance.id === dependency.instanceId
            );
            return (
              <div className="product-setting-row" key={dependency.instanceId}>
                <span>
                  {dependency.groupId} · {dependency.name}
                </span>
                {selected ? (
                  <>
                    <Status value={appGroupDisplayStatus(selected)} />
                    <Button
                      onClick={() => controls.inspect(worktree, selected)}
                      variant="link"
                    >
                      View instance
                    </Button>
                  </>
                ) : (
                  <span className="product-muted">
                    Binding differs from the current selection
                  </span>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
      {group.cleanupOnly ? (
        <Blank
          description="This group remains available for cleanup. Stop it before using its replacement configuration."
          title="Previous configuration"
        />
      ) : null}
    </>
  );
}

function RunContext({
  group,
  onTasks,
}: {
  group: AppGroupSnapshot;
  onTasks: () => void;
}) {
  return (
    <div className="product-run-context">
      <ResourceUsage usage={group.resources} />
      <span>
        <span className="product-muted">Instance</span> {group.instance.name}
      </span>
      <span>
        <span className="product-muted">Runtime</span>{" "}
        {group.processRunning
          ? "Managed process running"
          : "No managed process"}
      </span>
      {group.run ? (
        <span>
          <span className="product-muted">Run created</span>{" "}
          <time dateTime={group.run.startedAt}>
            {new Date(group.run.startedAt).toLocaleString()}
          </time>
        </span>
      ) : null}
      <Button onClick={onTasks} size="sm" variant="link">
        View worktree tasks
      </Button>
    </div>
  );
}
