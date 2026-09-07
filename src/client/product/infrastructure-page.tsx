import { DatabaseIcon } from "lucide-react";
import { useState } from "react";

import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { appGroupDisplayStatus } from "../components/app-group-status";
import { Button } from "../components/ui/button";
import { type GroupControls, GroupToggle } from "./environment-list";
import {
  AppLink,
  Blank,
  countLabel,
  PageHeading,
  ResourceUsage,
  Search,
  Status,
} from "./primitives";

export function InfrastructurePage({
  data,
  controls,
}: {
  data: WorkspaceSnapshot;
  controls: GroupControls;
}) {
  const [search, setSearch] = useState("");
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
          group,
          worktree,
          consumers: [worktree],
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
          unused.set(instance.id, { instance, group, worktree });
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
        description="Shared and dedicated infrastructure instances for this project."
        title="Infrastructure"
      />
      <div className="product-filterbar">
        <Search
          onChange={setSearch}
          placeholder="Search instances…"
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
                <h2>{group.instance.name}</h2>
                <p className="product-muted">{group.name}</p>
              </div>
              <Status value={appGroupDisplayStatus(group)} />
              <span className="product-muted">
                Selected by {consumers.length} worktrees
              </span>
              <div className="product-actions">
                <Button
                  onClick={() => controls.inspect(worktree, group)}
                  variant="outline"
                >
                  View logs
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
                <AppLink app={app} key={app.id} />
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
                <h2>{instance.name}</h2>
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
                {cleanup ? "Inspect run" : "Choose instance in worktree"}
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
                : `Open ${worktree.branch} to select this instance before starting it.`}
            </p>
          </section>
        );
      })}
      {shown.length === 0 && shownUnused.length === 0 ? (
        <Blank
          description="Set an app group's category to infrastructure in project configuration to show its instances here."
          title="No infrastructure instances"
        />
      ) : null}
    </>
  );
}
