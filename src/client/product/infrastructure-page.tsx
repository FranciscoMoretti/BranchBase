import { ChevronDownIcon, DatabaseIcon } from "lucide-react";
import { useState } from "react";

import { appGroupStatus } from "../../app-group/status";
import type { WorkspaceSnapshot } from "../../project/worktree-status-contract";
import { Button } from "../components/ui/button";
import { useCommand } from "../mutations";
import { GroupToggle } from "./environment-list";
import type { GroupControls } from "./environment-list";
import { ManagedResourceCatalog } from "./managed-resource-catalog";
import {
  AppLink,
  CopyButton,
  Blank,
  ErrorNotice,
  countLabel,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";
import { ResourceCatalog } from "./resource-catalog";

export const InfrastructurePage = ({
  data,
  controls,
}: {
  data: WorkspaceSnapshot;
  controls: GroupControls;
}) => {
  const enable = useCommand("enable-resource-profiles", data.repoPath);
  const [search, setSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const instances = new Map<
    string,
    {
      group: WorkspaceSnapshot["worktrees"][number]["appGroups"][number];
      worktree: WorkspaceSnapshot["worktrees"][number];
      consumers: WorkspaceSnapshot["worktrees"];
    }
  >();
  for (const worktree of data.worktrees) {
    for (const group of worktree.appGroups.filter(
      (item) => item.category === "infrastructure"
    )) {
      const existing = instances.get(group.instance.id);
      if (existing) {
        existing.consumers.push(worktree);
      } else {
        instances.set(group.instance.id, {
          consumers: [worktree],
          group,
          worktree,
        });
      }
    }
  }
  const unused = new Map<
    string,
    {
      instance: WorkspaceSnapshot["worktrees"][number]["appGroups"][number]["instances"][number];
      group: WorkspaceSnapshot["worktrees"][number]["appGroups"][number];
      worktree: WorkspaceSnapshot["worktrees"][number];
    }
  >();
  for (const worktree of data.worktrees) {
    for (const group of worktree.appGroups.filter(
      (item) => item.category === "infrastructure"
    )) {
      for (const instance of group.instances) {
        if (!(instances.has(instance.id) || unused.has(instance.id))) {
          unused.set(instance.id, { group, instance, worktree });
        }
      }
    }
  }
  const shown = [...instances.values()].filter(({ group }) =>
    `${group.name} ${group.instance.name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const shownUnused = [...unused.values()].filter(({ instance, group }) =>
    `${instance.name} ${group.name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  return (
    <>
      <PageHeading
        description="Inspect this project’s connections or manage shared resources on this machine."
        title="Infrastructure"
      />
      <div>
        <h2>Project connections</h2>
        <p className="product-muted">
          Selected infrastructure for {data.repoName}. Applications start and
          stop independently.
        </p>
      </div>
      {data.projectDefaultConfig.profiles ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={enable.isPending}
            onClick={() =>
              enable.mutate({
                repoPath: data.repoPath,
                revision: data.projectDefaultConfigRevision,
              })
            }
          >
            {enable.isPending
              ? "Enabling profiles…"
              : "Enable resource profiles"}
          </Button>
          <span className="product-muted">
            Adds Shared development and Isolated development to this project’s
            configuration.
          </span>
        </div>
      )}
      <ErrorNotice error={enable.error} />
      <div className="product-filterbar">
        <Search
          onChange={setSearch}
          placeholder="Search project connections…"
          value={search}
        />
        <span className="product-muted">
          {countLabel(shown.length + shownUnused.length, "instance")}
        </span>
      </div>
      <div className="product-infrastructure">
        {shown.map(({ group, worktree, consumers }) => (
          <article key={group.instance.id}>
            <div className="product-infra-heading">
              <DatabaseIcon />
              <div>
                <h2>Instance {group.instance.name}</h2>
                <p className="product-muted">{group.name}</p>
              </div>
              <Status value={appGroupStatus(group)} />
              <span className="product-muted">
                Selected by {countLabel(consumers.length, "worktree")}
              </span>
              <div className="product-actions">
                <Button
                  onClick={() => controls.inspect(worktree, group)}
                  variant="outline"
                >
                  View endpoints & logs
                </Button>
                <GroupToggle
                  controls={controls}
                  group={group}
                  worktree={worktree}
                />
              </div>
            </div>
            <div className="product-infra-apps">
              <ResourceUsage usage={group.resources} />
              {group.apps.map((app) => (
                <span className="product-infra-endpoint" key={app.id}>
                  {app.open && app.url ? (
                    <AppLink app={app} />
                  ) : (
                    <span>{app.label}</span>
                  )}
                  <code>
                    {app.port
                      ? `${app.host?.includes(":") ? `[${app.host}]` : (app.host ?? "127.0.0.1")}:${app.port}`
                      : "Not allocated"}
                  </code>
                  <CopyButton
                    label={`Copy ${app.label} endpoint`}
                    value={
                      app.port
                        ? `${app.host?.includes(":") ? `[${app.host}]` : (app.host ?? "127.0.0.1")}:${app.port}`
                        : ""
                    }
                  />
                </span>
              ))}
            </div>
            <div>
              <Button
                aria-expanded={expanded.includes(group.instance.id)}
                onClick={() =>
                  setExpanded((current) =>
                    current.includes(group.instance.id)
                      ? current.filter((id) => id !== group.instance.id)
                      : [...current, group.instance.id]
                  )
                }
                variant="ghost"
              >
                Selected worktrees ({consumers.length})
              </Button>
              <div hidden={!expanded.includes(group.instance.id)}>
                <div className="product-consumers">
                  {consumers.map((consumer) => (
                    <Button
                      key={consumer.id}
                      onClick={() => controls.inspect(consumer, group)}
                      size="sm"
                      variant="outline"
                    >
                      {consumer.branch}
                    </Button>
                  ))}
                </div>
                <p className="product-muted">
                  Selection shows configured connections, not verified active
                  traffic.
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
      {shownUnused.map(({ instance, group, worktree }) => {
        const owner = data.worktrees.find((item) =>
          item.appGroups.some(
            (candidate) =>
              candidate.cleanupOnly && candidate.instance.id === instance.id
          )
        );
        const cleanup = owner?.appGroups.find(
          (candidate) =>
            candidate.cleanupOnly && candidate.instance.id === instance.id
        );
        return (
          <section className="product-settings-panel" key={instance.id}>
            <div className="product-infra-heading">
              <DatabaseIcon />
              <div>
                <h2>Instance {instance.name}</h2>
                <p className="product-muted">
                  {group.name} · No selecting worktrees
                </p>
              </div>
              <Status value={instance.running ? "running" : "stopped"} />
              <Button
                onClick={() =>
                  controls.inspect(
                    owner ?? worktree,
                    cleanup ?? group,
                    cleanup ? "logs" : "configuration"
                  )
                }
                variant="outline"
              >
                {cleanup ? "Inspect run" : "Change connection"}
              </Button>
              {cleanup && owner ? (
                <GroupToggle
                  controls={controls}
                  group={cleanup}
                  worktree={owner}
                />
              ) : null}
            </div>
            <p className="product-muted">
              {cleanup
                ? "This retained run is still owned by BranchBase and can be stopped."
                : `Open ${worktree.branch} to change its connection. Manage this instance independently under Resources on this machine.`}
            </p>
          </section>
        );
      })}
      {shown.length === 0 && shownUnused.length === 0 ? (
        <Blank
          description={
            search
              ? "Try another resource or instance name."
              : "Set an app group's category to infrastructure in project configuration to show its connections here."
          }
          title={
            search
              ? "No matching project connections"
              : "No project infrastructure connections"
          }
        />
      ) : null}
      <section className="product-machine-catalog">
        <Button
          variant="ghost"
          className="product-machine-toggle"
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen((open) => !open)}
        >
          <ChevronDownIcon className={catalogOpen ? "rotate-180" : ""} />
          <span>
            <strong>Resources on this machine</strong>
            <span className="product-muted">
              {countLabel(
                (data.managedResources?.length ?? 0) +
                  (data.existingResources?.length ?? 0),
                "resource"
              )}{" "}
              · Shared across projects
            </span>
          </span>
        </Button>
        <div hidden={!catalogOpen} className="product-machine-content">
          <p className="product-muted">
            Definitions provide lifecycle recipes; their named instances provide
            connections. Registering a definition starts nothing.
          </p>
          <ManagedResourceCatalog data={data} />
          <ResourceCatalog data={data} />
        </div>
      </section>
      <p className="product-muted">
        Usage metrics cover tracked host processes and worktree files. Docker
        CPU, memory, and volumes are not included.
      </p>
    </>
  );
};
