import {
  ArrowRightIcon,
  FolderGit2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  ListFilterIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import type { ProjectOverview } from "../../project/catalog-contract";
import { appGroupIsRunning } from "../../project/worktree-status-contract";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useCommand } from "../mutations";
import { FormFeedback, QueryContent } from "./async-state";
import { hrefFor, useProjects } from "./data";
import { DiscoveryDialog } from "./discovery-dialog";
import { ServiceLink, ServiceOverflow } from "./observed-project-page";
import {
  AppLink,
  Blank,
  countLabel,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";
import { projectIsActive, selectProjects } from "./project-list";
import type { ProjectFilter, ProjectSort } from "./project-list";
import { runtimeCounts } from "./runtime-counts";
import { runtimeSummary } from "./runtime-summary";

export { projectIsActive } from "./project-list";

const attentionHref = (
  repo: string,
  worktree: {
    id: string;
    primaryAppGroup: string;
    configuration: { trusted: boolean };
  }
): string =>
  hrefFor({
    group: worktree.primaryAppGroup,
    panel: worktree.configuration.trusted ? "logs" : "configuration",
    repo,
    worktree: worktree.id,
  });
const projectSummary = (
  project: ProjectOverview,
  active: number,
  detected: number
) => {
  if (project.workspace) {
    return `${countLabel(project.workspace.worktrees.length, "worktree")} · ${active} active · ${countLabel(project.workspace.globalRunningCount, "group")} running`;
  }
  if (project.observation) {
    return `${countLabel(project.observation.worktrees.length, "worktree")} · ${countLabel(detected, "service")} detected`;
  }
  return "Inspection unavailable";
};
const projectStateLabel = (project: ProjectOverview) => {
  if (projectIsActive(project)) {
    return "Services running";
  }
  return project.workspace ? "All stopped" : "Observing";
};
const projectResources = (project: ProjectOverview) =>
  project.workspace?.resources ?? project.observation?.resources;
const attentionNotice = (
  project: ProjectOverview,
  warning:
    | NonNullable<ProjectOverview["workspace"]>["worktrees"][number]
    | undefined
) => {
  if (project.observation?.warning) {
    return {
      href: hrefFor({ repo: project.path, view: "activity" }),
      label: project.observation.warning,
    };
  }
  if (warning) {
    return {
      href: attentionHref(project.path, warning),
      label: warning.configuration.trusted
        ? `Needs attention · ${warning.branch}`
        : "Review commands",
    };
  }
  return null;
};

const emptyProjectMessage = (
  project: ProjectOverview,
  hasWorkspace: boolean,
  detectedCount: number
): ReactNode => {
  if (project.pins.length > 0 || !hasWorkspace || detectedCount > 0) {
    return null;
  }
  return (
    <span className="product-muted">Pin app links from an environment</span>
  );
};

const ProjectRow = ({ project }: { project: ProjectOverview }) => {
  const { workspace } = project;
  const detected =
    project.observation?.worktrees.flatMap((worktree) =>
      worktree.services
        .filter((service) => !service.managed)
        .map((service) => ({ ...service, branch: worktree.branch }))
    ) ?? [];
  const pins = useCommand("save-project");
  const remove = useCommand("remove-project");
  const [dialog, setDialog] = useState<"pins" | "remove" | null>(null);
  const active =
    workspace?.worktrees.filter((worktree) =>
      worktree.appGroups.some(appGroupIsRunning)
    ).length ?? 0;
  const warning = workspace?.worktrees.find(
    (worktree) =>
      worktree.configuration.error ||
      !worktree.configuration.trusted ||
      runtimeSummary(worktree).value === "partial"
  );
  const attention = attentionNotice(project, warning);
  return (
    <article className="product-project-row">
      <FolderGit2Icon className="product-project-icon" />
      <div className="product-project-identity">
        <a href={hrefFor({ repo: project.path })}>{project.name}</a>
        <span className="product-muted" title={project.path}>
          {project.path}
        </span>
      </div>
      <div className="product-project-summary">
        <ResourceUsage usage={projectResources(project)} />
        <span>{projectSummary(project, active, detected.length)}</span>
        <span
          className="product-muted"
          title="Most recent recorded app or service start across this repository's worktrees"
        >
          {project.lastStartedAt ? (
            <>
              Last started{" "}
              <time dateTime={project.lastStartedAt}>
                {new Date(project.lastStartedAt).toLocaleString([], {
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  month: "short",
                })}
              </time>
            </>
          ) : (
            "No recorded starts"
          )}
        </span>
        <div className="product-actions">
          {project.pins.slice(0, 2).map((pin) => {
            const worktree = workspace?.worktrees.find(
              (item) => item.id === pin.worktreeId
            );
            const app = worktree?.appGroups
              .find((group) => group.id === pin.groupId)
              ?.apps.find((item) => item.id === pin.appId);
            return app ? (
              <span
                className="product-pin"
                key={`${pin.worktreeId}:${pin.groupId}:${pin.appId}`}
              >
                <AppLink app={app} />
                <small>{worktree?.branch}</small>
              </span>
            ) : null;
          })}
          {project.pins.length > 2 ? (
            <Button
              onClick={() => {
                pins.reset();
                setDialog("pins");
              }}
              size="sm"
              variant="link"
            >
              +{project.pins.length - 2} apps
            </Button>
          ) : null}
          {detected.slice(0, 2).map((service) => (
            <span
              className="product-pin"
              key={`${service.pid}:${service.port}`}
            >
              <ServiceLink service={service} />
              <small>{service.branch}</small>
            </span>
          ))}
          <ServiceOverflow services={detected.slice(2)} />
          {emptyProjectMessage(project, Boolean(workspace), detected.length)}
        </div>
      </div>
      <div className="product-project-condition">
        {project.error ? (
          <span className="product-warning">{project.error}</span>
        ) : null}
        {!project.error && attention ? (
          <a className="product-warning" href={attention.href}>
            {attention.label}
          </a>
        ) : null}
        {project.error || attention ? null : (
          <Status
            label={projectStateLabel(project)}
            value={active || detected.length ? "running" : "stopped"}
          />
        )}
      </div>
      <div className="product-actions">
        <a className="product-link" href={hrefFor({ repo: project.path })}>
          Open repository
          <ArrowRightIcon />
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={`Actions for ${project.name}`}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  pins.reset();
                  setDialog("pins");
                }}
              >
                Manage pinned apps ({project.pins.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  remove.reset();
                  setDialog("remove");
                }}
              >
                Remove from BranchBase…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !pins.isPending && !remove.isPending) {
            setDialog(null);
          }
        }}
        open={dialog !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "pins" ? "Pinned apps" : `Remove ${project.name}?`}
            </DialogTitle>
            <DialogDescription>
              {dialog === "pins"
                ? "Pinned links are qualified by worktree. Only ready apps can be opened."
                : "Repository files and worktrees remain on disk. BranchBase checks for owned resources before removing this project from the list."}
            </DialogDescription>
          </DialogHeader>
          <FormFeedback error={dialog === "pins" ? pins.error : remove.error} />
          {dialog === "pins" ? (
            <div>
              {project.pins.map((pin, index) => {
                const worktree = workspace?.worktrees.find(
                  (item) => item.id === pin.worktreeId
                );
                const app = worktree?.appGroups
                  .find((group) => group.id === pin.groupId)
                  ?.apps.find((item) => item.id === pin.appId);
                return (
                  <div
                    className="product-setting-row"
                    key={`${pin.worktreeId}:${pin.groupId}:${pin.appId}`}
                  >
                    <div>
                      {app ? (
                        <AppLink app={app} />
                      ) : (
                        <span>{pin.appId} · Unavailable</span>
                      )}
                      <p className="product-muted">
                        {worktree?.branch ?? "Worktree no longer available"}
                      </p>
                    </div>
                    <Button
                      aria-label={`Unpin ${app?.label ?? pin.appId}`}
                      disabled={pins.isPending}
                      onClick={() =>
                        pins.mutate({
                          pins: project.pins.filter(
                            (_, position) => position !== index
                          ),
                          repoPath: project.path,
                        })
                      }
                      variant="ghost"
                    >
                      Unpin
                    </Button>
                  </div>
                );
              })}
              {project.pins.length === 0 ? (
                <p className="product-muted">
                  Pin an app from its group details.
                </p>
              ) : null}
            </div>
          ) : (
            <DialogFooter>
              <Button
                disabled={remove.isPending}
                onClick={() => setDialog(null)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync({
                      repoPath: project.path,
                    });
                    setDialog(null);
                  } catch {
                    /* The dialog presents the error. */
                  }
                }}
              >
                Remove project
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
};
const projectsSummary = (projects: ProjectOverview[]) => {
  const { managedGroups, detectedServices } = runtimeCounts(projects);
  return `${`${projects.length} ${projects.length === 1 ? "repository" : "repositories"}`} · ${countLabel(managedGroups, "managed group")} running · ${countLabel(detectedServices, "detected service")}`;
};
export const ProjectsPage = () => {
  const projects = useProjects();
  const [search, setSearch] = useState("");
  const [add, setAdd] = useState<"project" | "folder" | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [sort, setSort] = useState<ProjectSort>("started");
  const unavailableSummary = projects.error
    ? "Project summary unavailable"
    : "Loading project summary…";
  const items = selectProjects(projects.data ?? [], search, filter, sort);
  return (
    <>
      <PageHeading
        description="Local codebases and what they have running"
        title="Repositories"
      >
        <a className="product-link" href={hrefFor({ view: "machine" })}>
          Development folders
        </a>
      </PageHeading>

      <p className="product-muted">
        {projects.data === undefined
          ? unavailableSummary
          : projectsSummary(projects.data)}
      </p>
      <div className="my-6 flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1 [&>div]:w-full">
          <Search
            onChange={setSearch}
            placeholder="Search repositories…"
            value={search}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Filter and sort repositories"
                variant={filter === "all" ? "outline" : "secondary"}
                size="icon"
              >
                <ListFilterIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Filter by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(value) => {
                  if (
                    value === "all" ||
                    value === "running" ||
                    value === "stopped" ||
                    value === "attention"
                  ) {
                    setFilter(value);
                  }
                }}
              >
                <DropdownMenuRadioItem value="all">
                  All repositories
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="running">
                  Running
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="stopped">
                  Stopped
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="attention">
                  Needs attention
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => {
                  if (value === "started" || value === "name") {
                    setSort(value);
                  }
                }}
              >
                <DropdownMenuRadioItem value="started">
                  Last started
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">
                  Name (A–Z)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => setAdd("project")}>
          <PlusIcon data-icon="inline-start" />
          Add repository
        </Button>
      </div>
      {search || filter !== "all" ? (
        <div className="mb-4 flex items-center gap-3">
          {projects.data === undefined ? null : (
            <output className="product-muted">
              {items.length} matching{" "}
              {items.length === 1 ? "repository" : "repositories"}
            </output>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
      <QueryContent label="Projects" query={projects}>
        <div className="product-project-list">
          {items.map((project) => (
            <ProjectRow key={project.path} project={project} />
          ))}
        </div>
        {items.length === 0 ? (
          <Blank
            description={
              search || filter !== "all"
                ? "Try another search or choose All to see your saved projects."
                : "Add an existing repository to manage its worktrees and apps."
            }
            title={
              search || filter !== "all"
                ? "No matching repositories"
                : "No repositories yet"
            }
          />
        ) : null}
      </QueryContent>
      {add ? (
        <DiscoveryDialog initialKind={add} onClose={() => setAdd(null)} />
      ) : null}
    </>
  );
};
