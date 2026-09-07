import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { Observation } from "../../controller/discovery-contract";
import type { ProjectOverview } from "../../controller/product-contract";
import {
  type AppGroupSnapshot,
  appGroupIsRunning,
  type WorkspaceSnapshot,
  type WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import { appGroupDisplayStatus } from "../components/app-group-status";
import { CreateWorktreeDialog } from "../components/create-worktree-dialog";
import { DeleteWorktreeDialog } from "../components/delete-worktree-dialog";
import { RepositoryTrustDialog } from "../components/repository-trust-dialog";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useCodexIntegration } from "../queries";
import { useRepositoryTrust } from "../use-repository-trust";
import { useWorktreeCommandActions } from "../use-worktree-command-actions";
import { ActivityPage } from "./activity-page";
import { hrefFor, type ProductLocation } from "./data";
import { EnvironmentList, type GroupControls } from "./environment-list";
import { GroupDetails } from "./group-details";
import { InfrastructurePage } from "./infrastructure-page";
import { DetectedServicesSection } from "./observed-project-page";
import {
  Blank,
  countLabel,
  ErrorNotice,
  PageHeading,
  ResourceUsage,
  Search,
} from "./primitives";
import { SettingsPage } from "./settings-page";

function needsAttention(worktree: WorktreeSnapshot): boolean {
  return Boolean(
    worktree.configuration.error ||
      !worktree.configuration.trusted ||
      worktree.setupState === "failed" ||
      worktree.appGroups.some(
        (group) => appGroupDisplayStatus(group) === "partial"
      )
  );
}

function isMissingEnvironment(
  location: ProductLocation,
  selectedGroup: AppGroupSnapshot | undefined
): boolean {
  return (
    location.view === "workspace" &&
    Boolean(location.worktree) &&
    !selectedGroup
  );
}
function isEnvironmentList(location: ProductLocation): boolean {
  return location.view === "workspace" && !location.worktree;
}

export function WorkspacePage({
  observation,
  data,
  project,
  location,
  navigate,
  refresh,
}: {
  observation?: Observation;
  data: WorkspaceSnapshot;
  project?: ProjectOverview;
  location: ProductLocation;
  navigate: (value: Partial<ProductLocation>) => void;
  refresh: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [create, setCreate] = useState(false);
  const [deleting, setDeleting] = useState<WorktreeSnapshot | null>(null);
  const [shared, setShared] = useState<{
    group: AppGroupSnapshot;
    worktree: WorktreeSnapshot;
    restart: boolean;
  } | null>(null);
  const codex = useCodexIntegration(data.repoPath);
  const trust = useRepositoryTrust({
    approval: { fingerprint: data.trustFingerprint },
    commands: data.trustCommands,
    repoPath: data.repoPath,
    required: data.trustRequired,
    trusted: data.trusted,
  });
  const actions = useWorktreeCommandActions({
    repoPath: data.repoPath,
    requestRepositoryTrust: trust.requestTrust,
    worktrees: data.worktrees,
  });
  const consumers = (group: AppGroupSnapshot) =>
    data.worktrees.filter((worktree) =>
      worktree.appGroups.some((item) => item.instance.id === group.instance.id)
    );
  const controls: GroupControls = {
    review: (worktree) =>
      trust.requestTrust("Review worktree commands", () => undefined, {
        trusted: false,
        commands: worktree.configuration.trustCommands,
        approvals: [{ fingerprint: worktree.configuration.trustFingerprint }],
      }),
    blocked: (worktree, group) =>
      Boolean(group.pending) ||
      consumers(group).some((consumer) =>
        actions.appGroupActionBlocked(consumer.id, group.id)
      ) ||
      actions.appGroupActionBlocked(worktree.id, group.id),
    inspect: (worktree, group, panel = "logs") =>
      navigate({
        ...location,
        worktree: worktree.id,
        group: group.id,
        panel,
        view: "workspace",
      }),
    toggle: (worktree, group) => {
      if (appGroupIsRunning(group) && consumers(group).length > 1) {
        setShared({ group, worktree, restart: false });
      } else {
        actions.toggleAppGroup(worktree, group);
      }
    },
    restart: (worktree, group) => {
      if (consumers(group).length > 1) {
        setShared({ group, worktree, restart: true });
      } else {
        actions.restartAppGroup(worktree, group);
      }
    },
    retry: actions.retryAppGroup,
  };
  const selected = data.worktrees.find(
    (worktree) => worktree.id === location.worktree
  );
  const selectedGroup = location.group
    ? selected?.appGroups.find((group) => group.id === location.group)
    : selected?.appGroups[0];
  const active = data.worktrees.filter((worktree) =>
    worktree.appGroups.some(appGroupIsRunning)
  );
  const visible = data.worktrees.filter(
    (worktree) =>
      `${worktree.name} ${worktree.branch} ${codex.data?.worktrees[worktree.id]?.tasks.map((task) => task.title).join(" ") ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "running" && worktree.appGroups.some(appGroupIsRunning)) ||
        (filter === "attention" && needsAttention(worktree)))
  );
  return (
    <>
      <ErrorNotice error={actions.commands.error} />
      {location.view === "settings" ? (
        <SettingsPage
          data={data}
          onSectionChange={(section) => navigate({ ...location, section })}
          project={project}
          review={() =>
            trust.requestTrust("Review commands", () => undefined, {
              trusted: false,
              commands: data.trustCommands,
              approvals: [{ fingerprint: data.trustFingerprint }],
            })
          }
          section={location.section}
        />
      ) : null}
      {location.view === "activity" ? (
        <ActivityPage repoPath={data.repoPath} />
      ) : null}
      {location.view === "infrastructure" ? (
        <InfrastructurePage controls={controls} data={data} />
      ) : null}
      {location.view === "workspace" && selected && selectedGroup ? (
        <GroupDetails
          codex={codex.data}
          codexError={codex.isError}
          controls={controls}
          group={selectedGroup}
          key={`${selected.id}:${selectedGroup.id}`}
          onBack={() => navigate({ repo: data.repoPath, view: "workspace" })}
          onClearLogs={() =>
            actions.commands.clearLogs.mutate({
              repoPath: data.repoPath,
              worktreeId: selected.id,
              appGroupName: selectedGroup.id,
            })
          }
          onConfigSource={(source) =>
            actions.commands.selectWorktreeConfigSource.mutate({
              repoPath: data.repoPath,
              worktreeId: selected.id,
              source,
            })
          }
          onCreateInstance={(name) =>
            actions.createAppGroupInstance(selected, selectedGroup, name)
          }
          onSelectInstance={(id) =>
            actions.selectAppGroupInstance(selected, selectedGroup, id)
          }
          onTabChange={(panel) => navigate({ ...location, panel })}
          project={project}
          repoPath={data.repoPath}
          tab={location.panel}
          worktree={selected}
        />
      ) : null}
      {isMissingEnvironment(location, selectedGroup) ? (
        <Blank
          description="This link refers to an environment that is no longer in the current configuration."
          title={
            selected
              ? "App group no longer available"
              : "Worktree no longer available"
          }
        >
          <Button
            onClick={() => navigate({ repo: data.repoPath })}
            variant="outline"
          >
            Back to environments
          </Button>
        </Blank>
      ) : null}
      {isEnvironmentList(location) ? (
        <>
          <PageHeading
            description={`${countLabel(data.worktrees.length, "worktree")} · ${active.length} active · ${countLabel(data.globalRunningCount, "group")} running`}
            title="Environments"
          >
            <ResourceUsage usage={data.resources} />
            <Button
              aria-label="Refresh workspace"
              onClick={() => {
                refresh();
                codex.refetch();
              }}
              size="icon"
              variant="outline"
            >
              <RefreshCwIcon />
            </Button>
            <Button onClick={() => setCreate(true)} variant="outline">
              <PlusIcon />
              Create worktree
            </Button>
          </PageHeading>
          <div className="product-filterbar">
            <Search
              onChange={setSearch}
              placeholder="Search worktrees…"
              value={search}
            />
            <fieldset
              aria-label="Filter worktrees"
              className="product-filter-options"
            >
              {[
                ["all", `All ${data.worktrees.length}`],
                ["running", `Running ${active.length}`],
                [
                  "attention",
                  `Needs attention ${data.worktrees.filter(needsAttention).length}`,
                ],
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
          </div>
          <EnvironmentList
            codex={codex.data}
            codexError={codex.isError}
            commandActions={actions.commandActions}
            controls={controls}
            expandedIds={expandedIds}
            onDelete={setDeleting}
            onExpand={(id, expanded) =>
              setExpandedIds((current) =>
                expanded
                  ? [...new Set([...current, id])]
                  : current.filter((value) => value !== id)
              )
            }
            worktrees={visible}
          />
          <DetectedServicesSection data={observation} />
          <div className="product-footer-link">
            <a
              className="product-link"
              href={hrefFor({ repo: data.repoPath, view: "infrastructure" })}
            >
              Shared infrastructure and instances
            </a>
          </div>
        </>
      ) : null}
      {create ? (
        <CreateWorktreeDialog
          mutation={actions.commands.createWorktree}
          onClose={() => setCreate(false)}
          repoPath={data.repoPath}
          requestRepositoryTrust={trust.requestTrust}
        />
      ) : null}
      {deleting ? (
        <DeleteWorktreeDialog
          mutation={actions.commands.deleteWorktree}
          onClose={() => setDeleting(null)}
          repoPath={data.repoPath}
          worktree={deleting}
        />
      ) : null}
      {trust.open ? (
        <RepositoryTrustDialog
          actionLabel={trust.actionLabel}
          commands={trust.commands}
          error={actions.commands.trustRepository.error}
          onClose={trust.dismiss}
          onTrust={() =>
            trust.approve(() =>
              actions.commands.trustRepository.mutateAsync({
                approvals: trust.approvals,
                repoPath: data.repoPath,
              })
            )
          }
          open
          pending={actions.commands.trustRepository.isPending}
          repoPath={data.repoPath}
        />
      ) : null}
      {shared ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setShared(null);
            }
          }}
          open
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {shared.restart ? "Restart" : "Stop"}{" "}
                {shared.group.instance.name}?
              </DialogTitle>
              <DialogDescription>
                {consumers(shared.group).length} worktrees select this instance.
                Their connections may be interrupted.{" "}
                {shared.group.stop === "command"
                  ? "The configured Stop command will run."
                  : "The managed process will be stopped."}
              </DialogDescription>
            </DialogHeader>
            <div className="product-consumers">
              {consumers(shared.group).map((consumer) => (
                <span key={consumer.id}>{consumer.branch}</span>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setShared(null)} variant="outline">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (shared.restart) {
                    actions.restartAppGroup(shared.worktree, shared.group);
                  } else {
                    actions.toggleAppGroup(shared.worktree, shared.group);
                  }
                  setShared(null);
                }}
              >
                {shared.restart ? "Restart" : "Stop"}{" "}
                {shared.group.instance.name}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
