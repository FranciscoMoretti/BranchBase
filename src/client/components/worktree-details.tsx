import { ArrowUpRightIcon, BotIcon, Clock3Icon } from "lucide-react";

import type { CodexTaskSnapshot } from "../../codex/codex-integration";
import { WorktreeConfigSourceSchema } from "../../config/worktree-config-source";
import type {
  WorktreeConfigSource,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { codexNewTaskUrl, codexOpenTaskUrl } from "../codex-links";
import { Badge } from "./ui/badge";
import { buttonVariants } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

function codexActivity(task: CodexTaskSnapshot): {
  className: string;
  label: string;
} {
  if (task.activity?.state === "working") {
    return { className: "bg-status-running-foreground", label: "Working" };
  }
  if (task.activity?.state === "waiting-for-approval") {
    return {
      className: "bg-status-partial-foreground",
      label: "Waiting approval",
    };
  }
  if (!task.activity || task.activity.state === "unknown") {
    return { className: "bg-muted-foreground", label: "Activity unknown" };
  }
  return { className: "bg-muted-foreground", label: "Ready" };
}

function taskTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function CodexTasksSection({
  discoveryUnavailable,
  loading,
  tasks,
  worktreePath,
}: {
  discoveryUnavailable: boolean;
  loading: boolean;
  tasks: CodexTaskSnapshot[];
  worktreePath: string;
}) {
  const newTaskUrl = codexNewTaskUrl(worktreePath);
  let content = (
    <p className="mt-2 text-muted-foreground text-sm">
      No Codex tasks associated with this worktree.
    </p>
  );
  if (discoveryUnavailable) {
    content = (
      <p className="mt-2 text-muted-foreground text-sm">
        Task discovery is temporarily unavailable. You can still start a new
        Codex task for this worktree.
      </p>
    );
  } else if (loading) {
    content = (
      <p className="mt-2 text-muted-foreground text-sm">
        Discovering Codex tasks…
      </p>
    );
  } else if (tasks.length > 0) {
    content = (
      <ScrollArea className="mt-2 h-44 border" scrollbars={["vertical"]}>
        <div className="divide-y">
          {tasks.map((task) => {
            const activity = codexActivity(task);
            const openTaskUrl = codexOpenTaskUrl(task.id);
            return (
              <div className="px-3 py-2.5" key={task.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm">
                      {task.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        <span
                          className={`size-1.5 rounded-full ${activity.className}`}
                        />
                        {activity.label}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Clock3Icon className="size-3" />
                        Updated {taskTime(task.updatedAt)}
                      </span>
                      {task.contextSharedAt ? (
                        <span className="text-muted-foreground text-xs">
                          Context shared {taskTime(task.contextSharedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {openTaskUrl ? (
                    <a
                      aria-label={`Open ${task.title} in Codex`}
                      className={buttonVariants({
                        size: "icon-xs",
                        variant: "ghost",
                      })}
                      href={openTaskUrl}
                      title="Open task in Codex"
                    >
                      <ArrowUpRightIcon />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  }
  return (
    <section className="codex-tasks-section">
      <div className="section-kicker">Collaboration</div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="flex items-center gap-1.5">
            <BotIcon className="size-4" />
            Codex tasks
          </h3>
          <Badge variant="outline">
            {loading || discoveryUnavailable ? "—" : tasks.length}
          </Badge>
        </div>
        {newTaskUrl ? (
          <a className={buttonVariants({ size: "sm" })} href={newTaskUrl}>
            New task
          </a>
        ) : null}
      </div>
      {content}
    </section>
  );
}

export function WorktreeConfigurationSource({
  disabled,
  onSelect,
  worktree,
}: {
  disabled: boolean;
  onSelect: (source: WorktreeConfigSource) => void;
  worktree: WorktreeSnapshot;
}) {
  const { configuration } = worktree;
  const fallback = configuration.preference !== configuration.source;
  return (
    <section className="worktree-configuration-section">
      <div className="section-kicker">Configuration</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3>Configuration source</h3>
          <code className="block truncate text-muted-foreground text-xs">
            {configuration.path}
          </code>
        </div>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            const source = WorktreeConfigSourceSchema.safeParse(value);
            if (source.success && source.data !== configuration.preference) {
              onSelect(source.data);
            }
          }}
          value={configuration.preference}
        >
          <SelectTrigger
            aria-label="Configuration source"
            className="min-w-36"
            size="sm"
          >
            <SelectValue>
              {configuration.preference === "checkout"
                ? "This worktree"
                : "Project default"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="project-default">Project default</SelectItem>
              <SelectItem value="checkout">This worktree</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {fallback ? (
        <p className="mt-2 text-status-partial-foreground text-xs">
          Using Project default because the selected worktree configuration is
          unavailable.
        </p>
      ) : null}
      {configuration.error ? (
        <p className="mt-1 break-words text-destructive text-xs">
          {configuration.error}
        </p>
      ) : null}
    </section>
  );
}
