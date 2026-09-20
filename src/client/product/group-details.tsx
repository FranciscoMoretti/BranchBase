import { ArrowLeftIcon, DownloadIcon, PinIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { appGroupStatus } from "../../app-group/status";
import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";
import type { ProjectOverview } from "../../project/catalog-contract";
import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";
import { AppGroupInstanceControl } from "../components/app-group-instance-control";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  CodexTasksSection,
  WorktreeConfigurationSource,
} from "../components/worktree-details";
import { useLogs } from "../queries";
import { ActivityPage } from "./activity-page";
import { QueryContent } from "./async-state";
import { useProductCommand } from "./data";
import { GroupToggle } from "./environment-list";
import type { GroupControls } from "./environment-list";
import { isProductPanel } from "./location";
import type { ProductPanel } from "./location";
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
import { endpointRuntime, groupRuntimeReasons } from "./runtime-summary";

const RunContext = ({
  group,
  onTasks,
}: {
  group: AppGroupSnapshot;
  onTasks: () => void;
}) => (
  <div className="product-run-context">
    <ResourceUsage usage={group.resources} />
    <span>
      <span className="product-muted">Instance</span> {group.instance.name}
    </span>
    <span>
      <span className="product-muted">Runtime</span>{" "}
      {group.processRunning ? "Managed process running" : "No managed process"}
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

export const GroupDetails = ({
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
  tab: ProductPanel;
  onTabChange: (value: ProductPanel) => void;
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
}) => {
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
        All worktrees
      </Button>
      <PageHeading
        level={2}
        description={`${worktree.branch} · ${countLabel(group.apps.length, "app")}`}
        title={`${group.name} services`}
      >
        <Status value={appGroupStatus(group)} />
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
      {appGroupStatus(group) === "partial" ? (
        <Alert>
          <AlertDescription>
            {groupRuntimeReasons(group).join(" · ")}
            <Button
              disabled={controls.blocked(worktree, group)}
              onClick={() => controls.retry(worktree, group)}
              variant="link"
            >
              Retry readiness and routes
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="product-endpoints">
        <div className="product-endpoint-head">
          <span>App</span>
          <span>Readiness</span>
          <span>Access</span>
          <span>Actions</span>
        </div>
        {group.apps.map((app) => {
          const state = endpointRuntime(app, group);
          const pin = {
            appId: app.id,
            groupId: group.id,
            worktreeId: worktree.id,
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
                label={
                  app.readiness === "ready" && app.ownership !== "foreign"
                    ? "Ready"
                    : state.label
                }
                value={state.value}
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
                  disabled={save.isPending || !project}
                  onClick={() =>
                    save.mutate({
                      command: "save-project",
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
                      repoPath,
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
      <Tabs
        onValueChange={(value) => {
          if (isProductPanel(value)) {
            onTabChange(value);
          }
        }}
        value={tab}
      >
        <TabsList aria-label="Group details" variant="line">
          {["logs", "activity", "configuration", "tasks"].map((value) => (
            <TabsTrigger key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="logs">
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
        </TabsContent>
        <TabsContent value="activity">
          <ActivityPage
            groupId={group.id}
            repoPath={repoPath}
            worktreeId={worktree.id}
          />
        </TabsContent>
        <TabsContent value="configuration">
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
        </TabsContent>
        <TabsContent value="tasks">
          <CodexTasksSection
            discoveryUnavailable={codexError}
            loading={!(codex || codexError)}
            tasks={codex?.worktrees[worktree.id]?.tasks ?? []}
            worktreePath={worktree.path}
          />
        </TabsContent>
      </Tabs>
      {group.dependencies?.length ? (
        <section className="product-settings-panel">
          <h2>Dependencies</h2>
          <p className="product-muted">
            Instances referenced by this group&apos;s environment or start
            command.
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
                    <Status value={appGroupStatus(selected)} />
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
};
