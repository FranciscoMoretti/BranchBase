import {
  BoxIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlayIcon,
  GitBranchIcon,
  SquareIcon,
} from "lucide-react";

import { appGroupStatus } from "../../app-group/status";
import type { CodexIntegrationSnapshot } from "../../codex/codex-integration";
import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type {
  AppGroupSnapshot,
  AppEndpointSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";
import { AppGroupActionsMenu } from "../components/app-group-actions-menu";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Spinner } from "../components/ui/spinner";
import { WorktreeActionsMenu } from "../components/worktree-actions-menu";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { AppLink, Blank, Status } from "./primitives";
import {
  endpointRuntime,
  runtimeSummary,
  worktreeRuntimeReasons,
} from "./runtime-summary";

export interface GroupControls {
  blocked: (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => boolean;
  inspect: (
    worktree: WorktreeSnapshot,
    group: AppGroupSnapshot,
    panel?: string
  ) => void;
  restart: (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => void;
  retry: (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => void;
  review: (worktree: WorktreeSnapshot) => void;
  toggle: (worktree: WorktreeSnapshot, group: AppGroupSnapshot) => void;
}
export const GroupToggle = ({
  group,
  worktree,
  controls,
  compact = false,
}: {
  group: AppGroupSnapshot;
  worktree: WorktreeSnapshot;
  controls: GroupControls;
  compact?: boolean;
}) => {
  const running = appGroupIsRunning(group);
  const busy = controls.blocked(worktree, group);
  const actionIcon = running ? <SquareIcon /> : <PlayIcon />;
  const actionLabel = running ? "Stop" : "Start";
  return (
    <Button
      aria-label={`${running ? "Stop" : "Start"} ${group.name} in ${worktree.branch}`}
      disabled={busy}
      onClick={() => controls.toggle(worktree, group)}
      size={compact ? "icon-sm" : "sm"}
      title={`${running ? "Stop" : "Start"} ${group.name}`}
      variant={compact || running ? "outline" : "default"}
    >
      {busy ? <Spinner /> : actionIcon}
      {compact ? null : actionLabel}
    </Button>
  );
};
const AppOverflow = ({
  group,
  worktree,
  controls,
}: {
  group: AppGroupSnapshot;
  worktree: WorktreeSnapshot;
  controls: GroupControls;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={<Button size="sm" variant="link" />}>
      +{group.apps.length - 2} apps
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-72">
      <DropdownMenuGroup>
        <DropdownMenuLabel>
          {group.name} apps · {worktree.branch}
        </DropdownMenuLabel>
        {group.apps.slice(2).map((app) =>
          app.open && app.url ? (
            <DropdownMenuItem
              key={app.id}
              render={
                <a
                  aria-label={`Open ${app.label}`}
                  href={app.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="flex-1">{app.label}</span>
                  <Status {...endpointRuntime(app, group)} />
                  Open
                </a>
              }
            />
          ) : (
            <DropdownMenuItem
              key={app.id}
              onClick={() => controls.inspect(worktree, group)}
            >
              <span className="flex-1">{app.label}</span>
              <Status {...endpointRuntime(app, group)} />
            </DropdownMenuItem>
          )
        )}
        <DropdownMenuItem onClick={() => controls.inspect(worktree, group)}>
          View {group.name} details
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
const ServiceEndpoint = ({
  app,
  group,
}: {
  app: AppEndpointSnapshot;
  group: AppGroupSnapshot;
}) => {
  const state = endpointRuntime(app, group);
  const label =
    state.value === "running" && app.port ? `:${app.port}` : state.label;
  const showLink =
    app.open || app.readiness === "ready" || app.label !== group.name;
  return (
    <span className="product-service-endpoint">
      {showLink ? <AppLink app={app} name={app.label !== group.name} /> : null}
      <code>{label}</code>
    </span>
  );
};
export const GroupSummary = ({
  group,
  worktree,
  controls,
  expanded = false,
}: {
  group: AppGroupSnapshot;
  worktree: WorktreeSnapshot;
  controls: GroupControls;
  expanded?: boolean;
}) => {
  const status = appGroupStatus(group);
  return (
    <div
      className={expanded ? "product-group-expanded" : "product-group-compact"}
    >
      <div className="product-group-name">
        <Button
          onClick={() => controls.inspect(worktree, group)}
          size="sm"
          variant="ghost"
        >
          {expanded ? <BoxIcon /> : null}
          <Status label={group.name} value={status} />
        </Button>
        {group.instance.mode === "selectable" ? (
          <span className="product-instance-name">{group.instance.name}</span>
        ) : null}
      </div>
      <div className="product-group-links">
        {group.apps.slice(0, expanded ? undefined : 2).map((app) => (
          <ServiceEndpoint app={app} group={group} key={app.id} />
        ))}
        {!expanded && group.apps.length > 2 ? (
          <AppOverflow controls={controls} group={group} worktree={worktree} />
        ) : null}
        {status === "partial" ? (
          <Button
            onClick={() => controls.inspect(worktree, group)}
            size="sm"
            variant="link"
          >
            Needs attention · View logs
          </Button>
        ) : null}
      </div>
      {expanded ? null : (
        <GroupToggle
          compact
          controls={controls}
          group={group}
          worktree={worktree}
        />
      )}
      {expanded ? (
        <>
          <Status value={status} />
          <div className="product-actions">
            <GroupToggle
              controls={controls}
              group={group}
              worktree={worktree}
            />
            <AppGroupActionsMenu
              group={group}
              onRestart={() => controls.restart(worktree, group)}
              onRetry={() => controls.retry(worktree, group)}
              onToggle={() => controls.toggle(worktree, group)}
              pending={controls.blocked(worktree, group)}
              worktree={worktree}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};
const TaskSummary = ({
  tasks,
  onOpen,
  unavailable,
}: {
  tasks: CodexIntegrationSnapshot["worktrees"][string]["tasks"] | undefined;
  onOpen: () => void;
  unavailable: boolean;
}) => {
  const working = tasks?.some((task) => task.activity?.state === "working");
  const waiting = tasks?.some(
    (task) => task.activity?.state === "waiting-for-approval"
  );
  let label = tasks === undefined ? "Loading tasks…" : "No tasks";
  if (tasks?.length) {
    label = "Tasks idle or unknown";
  }
  let status = "stopped";
  if (working) {
    label = "Working";
    status = "running";
  }
  if (waiting) {
    label = "Waiting for approval";
    status = "partial";
  }
  if (unavailable) {
    label = "Tasks unavailable";
    status = "partial";
  }
  return (
    <Button onClick={onOpen} size="sm" variant="ghost">
      <Status label={label} value={status} />
      {tasks?.length ? (
        <span className="product-muted">· {tasks.length} tasks</span>
      ) : null}
    </Button>
  );
};
const hasTaskSummary = (
  tasks: CodexIntegrationSnapshot["worktrees"][string]["tasks"] | undefined,
  unavailable: boolean
) => Boolean(tasks?.length || unavailable);
const RuntimeReasons = ({ reasons }: { reasons: string[] }) =>
  reasons.length ? (
    <p className="product-runtime-reasons" title={reasons.join(" · ")}>
      {reasons.slice(0, 2).join(" · ")}
      {reasons.length > 2 ? ` · +${reasons.length - 2} more` : null}
    </p>
  ) : null;

const EnvironmentRow = ({
  worktree,
  groups,
  controls,
  commandActions,
  onDelete,
  tasks,
  expanded,
  setExpanded,
  codexError,
}: {
  worktree: WorktreeSnapshot;
  groups: AppGroupSnapshot[];
  controls: GroupControls;
  commandActions: WorktreeCommandActions;
  onDelete: (worktree: WorktreeSnapshot) => void;
  tasks?: CodexIntegrationSnapshot["worktrees"][string]["tasks"];
  codexError: boolean;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
}) => {
  const primary =
    worktree.appGroups.find((group) => group.id === worktree.primaryAppGroup) ??
    worktree.appGroups[0];
  const summary = runtimeSummary(worktree);
  const reasons = worktreeRuntimeReasons(worktree);
  return (
    <article className="product-environment">
      <div className="product-environment-heading">
        <Button
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${worktree.branch}`}
          onClick={() => setExpanded(!expanded)}
          size="icon-sm"
          variant="ghost"
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <div className="product-environment-title">
          <Button
            className="product-branch-button"
            disabled={!primary}
            onClick={() => controls.inspect(worktree, primary)}
            variant="ghost"
          >
            <GitBranchIcon />
            {worktree.branch}
          </Button>
          {worktree.isMain ? <Badge variant="secondary">Main</Badge> : null}
          <span className="product-muted">
            {tasks?.[0]?.title ?? worktree.name}
          </span>
        </div>
        <Status value={summary.value} label={summary.label} />
        <span className="product-readiness-count">
          {summary.ready}/{summary.total} ready
        </span>
        {hasTaskSummary(tasks, codexError) ? (
          <TaskSummary
            onOpen={() => controls.inspect(worktree, primary, "tasks")}
            tasks={tasks}
            unavailable={codexError}
          />
        ) : null}
        <WorktreeActionsMenu
          commandActions={commandActions}
          includeLifecycle={false}
          onDelete={() => onDelete(worktree)}
          onInspect={() => controls.inspect(worktree, primary)}
          pending={worktree.setupState === "running"}
          worktree={worktree}
        />
      </div>
      <RuntimeReasons reasons={reasons} />
      {worktree.configuration.trusted ? null : (
        <div className="product-trust-notice">
          <span>Commands need approval</span>
          <Button
            onClick={() => controls.review(worktree)}
            size="sm"
            variant="link"
          >
            Review commands
          </Button>
        </div>
      )}
      {worktree.configuration.error || worktree.setupState !== "idle" ? (
        <p className="product-row-notice">
          {worktree.configuration.error ??
            (worktree.setupState === "running"
              ? "Setting up this worktree…"
              : "Setup failed. Run setup again from the worktree menu.")}
        </p>
      ) : null}
      <div
        className={
          expanded ? "product-expanded-groups" : "product-compact-groups"
        }
      >
        {groups.slice(0, expanded ? undefined : 2).map((group) => (
          <GroupSummary
            controls={controls}
            expanded={expanded}
            group={group}
            key={`${group.id}:${group.instance.id}`}
            worktree={worktree}
          />
        ))}
        {!expanded && groups.length > 2 ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="link" />}>
              +{groups.length - 2} groups
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{worktree.branch}</DropdownMenuLabel>
                {groups.slice(2).map((group) => (
                  <DropdownMenuItem
                    key={group.id}
                    onClick={() => controls.inspect(worktree, group)}
                  >
                    <Status label={group.name} value={appGroupStatus(group)} />
                    <span className="product-muted">Details & controls</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => setExpanded(true)}>
                  Expand all groups
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {!expanded &&
        groups.slice(2).some((group) => appGroupStatus(group) === "partial") ? (
          <Button onClick={() => setExpanded(true)} variant="link">
            Additional groups need attention
          </Button>
        ) : null}
      </div>
    </article>
  );
};
export const EnvironmentList = ({
  worktrees,
  controls,
  commandActions,
  onDelete,
  codex,
  expandedIds,
  runningOnly = false,
  onExpand,
  codexError,
}: {
  worktrees: WorktreeSnapshot[];
  controls: GroupControls;
  commandActions: WorktreeCommandActions;
  onDelete: (worktree: WorktreeSnapshot) => void;
  codex?: CodexIntegrationSnapshot;
  codexError: boolean;
  expandedIds: string[];
  runningOnly?: boolean;
  onExpand: (id: string, expanded: boolean) => void;
}) => {
  const seen = new Set<string>();
  return (
    <div className="product-environments">
      {worktrees.map((worktree) => {
        const groups = runningOnly
          ? worktree.appGroups.filter((group) => {
              if (!appGroupIsRunning(group) || seen.has(group.instance.id)) {
                return false;
              }
              seen.add(group.instance.id);
              return true;
            })
          : worktree.appGroups;
        if (runningOnly && groups.length === 0) {
          return null;
        }
        return (
          <EnvironmentRow
            groups={groups}
            codexError={codexError}
            commandActions={commandActions}
            controls={controls}
            expanded={expandedIds.includes(worktree.id)}
            key={worktree.id}
            onDelete={onDelete}
            setExpanded={(value) => onExpand(worktree.id, value)}
            tasks={
              codex ? (codex.worktrees[worktree.id]?.tasks ?? []) : undefined
            }
            worktree={worktree}
          />
        );
      })}
      {worktrees.length === 0 ? (
        <Blank
          description="Try another search or filter."
          title="No matching worktrees"
        />
      ) : null}
    </div>
  );
};
