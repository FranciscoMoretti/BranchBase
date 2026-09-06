import {
  ArrowRightIcon,
  FolderGit2Icon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";
import type { ProjectOverview } from "../../controller/product-contract";
import { appGroupIsRunning } from "../../controller/workspace-snapshot";
import { appGroupDisplayStatus } from "../components/app-group-status";
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
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { QueryContent } from "./async-state";
import { hrefFor, useProductCommand, useProjects } from "./data";
import { DiscoveryDialog } from "./discovery-dialog";
import { ServiceLink, ServiceOverflow } from "./observed-project-page";
import {
  AppLink,
  Blank,
  countLabel,
  ErrorNotice,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";

export function projectIsActive(project: ProjectOverview): boolean {
  return (
    (project.workspace?.globalRunningCount ?? 0) > 0 ||
    Boolean(
      project.observation?.worktrees.some(
        (worktree) => worktree.services.length > 0
      )
    )
  );
}
function projectNeedsAttention(project: ProjectOverview): boolean {
  return Boolean(
    project.error ||
      project.workspace?.worktrees.some(
        (worktree) =>
          worktree.configuration.error ||
          !worktree.configuration.trusted ||
          worktree.setupState === "failed" ||
          worktree.appGroups.some(
            (group) => appGroupDisplayStatus(group) === "partial"
          )
      )
  );
}
function attentionHref(
  repo: string,
  worktree: {
    id: string;
    primaryAppGroup: string;
    configuration: { trusted: boolean };
  }
): string {
  return hrefFor({
    repo,
    worktree: worktree.id,
    group: worktree.primaryAppGroup,
    panel: worktree.configuration.trusted ? "logs" : "configuration",
  });
}
function projectSummary(
  project: ProjectOverview,
  active: number,
  detected: number
) {
  if (project.workspace) {
    return `${countLabel(project.workspace.worktrees.length, "worktree")} · ${active} active · ${countLabel(project.workspace.globalRunningCount, "group")} running`;
  }
  if (project.observation) {
    return `${countLabel(project.observation.worktrees.length, "worktree")} · ${countLabel(detected, "service")} detected`;
  }
  return "Inspection unavailable";
}
function projectStateLabel(project: ProjectOverview) {
  if (projectIsActive(project)) {
    return "Services running";
  }
  return project.workspace ? "All stopped" : "Observing";
}
function projectResources(project: ProjectOverview) {
  return project.workspace?.resources ?? project.observation?.resources;
}
function ProjectRow({ project }: { project: ProjectOverview }) {
  const workspace = project.workspace;
  const detected =
    project.observation?.worktrees.flatMap((worktree) =>
      worktree.services
        .filter((service) => !service.managed)
        .map((service) => ({ ...service, branch: worktree.branch }))
    ) ?? [];
  const mutation = useProductCommand();
  const [dialog, setDialog] = useState<"pins" | "remove" | null>(null);
  const active =
    workspace?.worktrees.filter((worktree) =>
      worktree.appGroups.some(appGroupIsRunning)
    ).length ?? 0;
  const warning = workspace?.worktrees.find(
    (worktree) =>
      worktree.configuration.error ||
      !worktree.configuration.trusted ||
      worktree.appGroups.some(
        (group) => appGroupDisplayStatus(group) === "partial"
      )
  );
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
            <Button onClick={() => setDialog("pins")} size="sm" variant="link">
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
          {project.pins.length === 0 && workspace && !detected.length ? (
            <span className="product-muted">
              Pin app links from an environment
            </span>
          ) : null}
        </div>
      </div>
      <div className="product-project-condition">
        {project.error ? (
          <span className="product-warning">{project.error}</span>
        ) : null}
        {!project.error && warning ? (
          <a
            className="product-warning"
            href={attentionHref(project.path, warning)}
          >
            {warning.configuration.trusted
              ? `Needs attention · ${warning.branch}`
              : "Review commands"}
          </a>
        ) : null}
        {project.error || warning ? null : (
          <Status
            label={projectStateLabel(project)}
            value={active || detected.length ? "running" : "stopped"}
          />
        )}
      </div>
      <div className="product-actions">
        <a className="product-link" href={hrefFor({ repo: project.path })}>
          Open project
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
              <DropdownMenuItem onClick={() => setDialog("pins")}>
                Manage pinned apps ({project.pins.length})
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("remove")}>
                Remove from BranchBase…
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
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
          <ErrorNotice error={mutation.error} />
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
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          command: "save-project",
                          repoPath: project.path,
                          pins: project.pins.filter(
                            (_, position) => position !== index
                          ),
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
              <Button onClick={() => setDialog(null)} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={mutation.isPending}
                onClick={async () => {
                  try {
                    await mutation.mutateAsync({
                      command: "remove-project",
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
}
function projectsSummary(projects: ProjectOverview[]) {
  const groups = projects.reduce(
    (total, project) => total + (project.workspace?.globalRunningCount ?? 0),
    0
  );
  const detected = projects.reduce(
    (total, project) =>
      total +
      (project.observation?.worktrees.flatMap((worktree) =>
        worktree.services.filter((service) => !service.managed)
      ).length ?? 0),
    0
  );
  return `${countLabel(projects.length, "project")} · ${countLabel(groups, "group")} running · ${countLabel(detected, "service")} detected`;
}
export function ProjectsPage() {
  const projects = useProjects();
  const [search, setSearch] = useState("");
  const [add, setAdd] = useState<"project" | "folder" | null>(null);
  const [filter, setFilter] = useState("all");
  const unavailableSummary = projects.error
    ? "Project summary unavailable"
    : "Loading project summary…";
  const items = (projects.data ?? [])
    .toSorted(
      (a, b) =>
        Number(projectIsActive(b)) - Number(projectIsActive(a)) ||
        a.name.localeCompare(b.name)
    )
    .filter(
      (project) =>
        (filter === "all" ||
          (filter === "running" && projectIsActive(project)) ||
          (filter === "attention" && projectNeedsAttention(project))) &&
        `${project.name} ${project.path}`
          .toLowerCase()
          .includes(search.toLowerCase())
    );
  return (
    <>
      <PageHeading
        description="Local codebases and what they have running"
        title="Projects"
      >
        <a className="product-link" href={hrefFor({ view: "machine" })}>
          Development folders
        </a>
        <Button onClick={() => setAdd("project")}>
          <PlusIcon />
          Add project
        </Button>
      </PageHeading>

      <p className="product-muted">
        {projects.data === undefined
          ? unavailableSummary
          : projectsSummary(projects.data)}
      </p>
      <div className="product-filterbar">
        <Search
          onChange={setSearch}
          placeholder="Search projects…"
          value={search}
        />
        <fieldset
          aria-label="Filter projects"
          className="product-filter-options"
        >
          {[
            ["all", "All"],
            ["running", "Running"],
            ["attention", "Needs attention"],
          ].map(([value, label]) => (
            <Button
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
              variant="ghost"
            >
              {label}
            </Button>
          ))}
        </fieldset>
        <a className="product-link" href={hrefFor({ view: "activity" })}>
          View activity
          <ArrowRightIcon />
        </a>
      </div>
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
                ? "No matching projects"
                : "No projects yet"
            }
          />
        ) : null}
      </QueryContent>
      {add ? (
        <DiscoveryDialog initialKind={add} onClose={() => setAdd(null)} />
      ) : null}
    </>
  );
}
