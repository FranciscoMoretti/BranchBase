import {
  ActivityIcon,
  BoxesIcon,
  ChevronsUpDownIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitForkIcon,
  LayoutGridIcon,
  ListIcon,
  LogsIcon,
  SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import type { ProjectOverview } from "../../project/catalog-contract";
import type { Observation } from "../../project/discovery-contract";
import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar";
import { hrefFor } from "./data";
import type { ProductLocation } from "./data";
import { runtimeCounts } from "./runtime-counts";
import { runtimeSummary } from "./runtime-summary";
import { SidebarSearch } from "./sidebar-search";

const EMPTY_PROJECTS: ProjectOverview[] = [];

interface ShellProps {
  children: ReactNode;
  location: ProductLocation;
  name?: string;
  projects?: ProjectOverview[];
  workspace?: WorkspaceSnapshot;
  observation?: Observation;
}
const NavigationLink = ({
  href,
  label,
  icon: Icon,
  active,
  detail,
}: {
  href: string;
  label: string;
  icon: typeof LayoutGridIcon;
  active?: boolean;
  detail?: string;
}) => {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={detail ? `${label} · ${detail}` : label}
        render={
          <a
            aria-label={detail ? `${label} · ${detail}` : label}
            aria-current={active ? "page" : undefined}
            href={href}
            onClick={() => setOpenMobile(false)}
          />
        }
      >
        <Icon />
        <span className={detail ? "product-sidebar-runtime" : undefined}>
          {label}
          {detail ? <small>{detail}</small> : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};
const Navigation = ({
  location,
  name,
  projects = EMPTY_PROJECTS,
  workspace,
  observation,
}: Omit<ShellProps, "children">) => {
  const { setOpenMobile } = useSidebar();
  const scoped =
    Boolean(location.repo) &&
    location.view !== "machine" &&
    location.view !== "running";
  const counts = projects.length ? runtimeCounts(projects) : undefined;
  const worktrees =
    workspace?.worktrees.map((worktree) => ({
      ...worktree,
      status: runtimeSummary(worktree),
    })) ??
    observation?.worktrees.map((worktree) => ({
      ...worktree,
      status: {
        label: worktree.services.length
          ? "Services detected"
          : "No listeners detected",
        value: worktree.services.length ? "running" : "stopped",
      },
    })) ??
    [];
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <NavigationLink href="/?" icon={GitForkIcon} label="BranchBase" />
        </SidebarMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className="product-repository-switcher"
                    size="lg"
                  />
                }
                aria-label="Switch repository"
              >
                <FolderGit2Icon />
                <span>
                  {scoped ? (name ?? "Repository") : "All repositories"}
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-96 w-64 overflow-y-auto"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={
                      <a
                        aria-label="All repositories"
                        href="/?"
                        onClick={() => setOpenMobile(false)}
                      />
                    }
                  >
                    <LayoutGridIcon />
                    All repositories
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.path}
                      render={
                        <a
                          aria-label={project.name}
                          href={hrefFor({ repo: project.path })}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <FolderGit2Icon />
                      <span className="truncate">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          <SidebarSearch projects={projects} />
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {scoped ? (
              <>
                <NavigationLink
                  active={location.view === "workspace" && !location.worktree}
                  href={hrefFor({ repo: location.repo })}
                  icon={LayoutGridIcon}
                  label="Overview"
                />
                <NavigationLink
                  active={location.view === "worktrees"}
                  href={hrefFor({ repo: location.repo, view: "worktrees" })}
                  icon={GitBranchIcon}
                  label="Worktrees"
                />
                <NavigationLink
                  active={location.view === "logs"}
                  href={hrefFor({ repo: location.repo, view: "logs" })}
                  icon={LogsIcon}
                  label="Logs"
                />
                <NavigationLink
                  active={location.view === "infrastructure"}
                  href={hrefFor({
                    repo: location.repo,
                    view: "infrastructure",
                  })}
                  icon={BoxesIcon}
                  label="Infrastructure"
                />
                <NavigationLink
                  active={location.view === "activity"}
                  href={hrefFor({ repo: location.repo, view: "activity" })}
                  icon={ListIcon}
                  label="Activity"
                />
                <NavigationLink
                  active={location.view === "settings"}
                  href={hrefFor({ repo: location.repo, view: "settings" })}
                  icon={SettingsIcon}
                  label="Settings"
                />
              </>
            ) : (
              <>
                <NavigationLink
                  active={location.view === "workspace"}
                  href="/?"
                  icon={LayoutGridIcon}
                  label="Repositories"
                />
                <NavigationLink
                  active={location.view === "activity"}
                  href={hrefFor({ view: "activity" })}
                  icon={ListIcon}
                  label="Activity"
                />
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>
            {scoped ? "Worktrees" : "Repositories"}
          </SidebarGroupLabel>
          <SidebarMenu>
            {scoped
              ? worktrees.map((worktree) => (
                  <SidebarMenuItem key={worktree.id}>
                    <SidebarMenuButton
                      isActive={location.worktree === worktree.id}
                      tooltip={`${worktree.branch} · ${worktree.status.label}`}
                      render={
                        <a
                          aria-label={worktree.branch}
                          aria-current={
                            location.worktree === worktree.id
                              ? "page"
                              : undefined
                          }
                          href={hrefFor({
                            repo: location.repo,
                            worktree: worktree.id,
                          })}
                          onClick={() => setOpenMobile(false)}
                        />
                      }
                    >
                      <GitBranchIcon />
                      <span className="truncate">{worktree.branch}</span>
                      <span
                        aria-label={worktree.status.label}
                        className="product-runtime-dot"
                        data-status={worktree.status.value}
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              : projects.map((project) => (
                  <NavigationLink
                    href={hrefFor({ repo: project.path })}
                    icon={FolderGit2Icon}
                    key={project.path}
                    label={project.name}
                  />
                ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <NavigationLink
            active={location.view === "running"}
            detail={
              counts
                ? `${counts.managedGroups} managed · ${counts.detectedServices} detected`
                : undefined
            }
            href={hrefFor({ view: "running" })}
            icon={ActivityIcon}
            label="Running"
          />
          <NavigationLink
            active={location.view === "machine"}
            href={hrefFor({ view: "machine" })}
            icon={SettingsIcon}
            label="BranchBase settings"
          />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
const titles = {
  activity: "Activity",
  infrastructure: "Infrastructure",
  logs: "Logs",
  machine: "Settings",
  running: "Running",
  settings: "Settings",
  workspace: "Overview",
  worktrees: "Worktrees",
};
export const Shell = (props: ShellProps) => {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("branchbase:sidebar") !== "collapsed";
    } catch {
      return true;
    }
  });
  const { location, name, children } = props;
  const scoped =
    Boolean(location.repo) &&
    location.view !== "machine" &&
    location.view !== "running";
  return (
    <SidebarProvider
      className="product-shell"
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        try {
          localStorage.setItem(
            "branchbase:sidebar",
            value ? "expanded" : "collapsed"
          );
        } catch {
          /* Navigation remains usable without storage. */
        }
      }}
    >
      <Navigation {...props} />
      <SidebarInset>
        <header className="product-header">
          <SidebarTrigger />
          <nav aria-label="Breadcrumb" className="product-breadcrumb">
            <a href="/?">All repositories</a>
            <span aria-hidden="true">/</span>
            {scoped ? (
              <a
                className="product-crumb"
                href={hrefFor({ repo: location.repo })}
              >
                {name ?? "Repository"}
              </a>
            ) : (
              <span>
                {location.view === "workspace"
                  ? "Overview"
                  : titles[location.view]}
              </span>
            )}
          </nav>
        </header>
        <div className="product-content" id="main-content">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};
