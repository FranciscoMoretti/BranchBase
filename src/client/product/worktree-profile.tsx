import { useState } from "react";

import { appGroupStatus } from "../../app-group/status";
import type { WorktreeSnapshot } from "../../project/worktree-status-contract";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useCommand } from "../mutations";
import { FormFeedback } from "./async-state";
import { ErrorNotice, Status } from "./primitives";

type Profile = NonNullable<WorktreeSnapshot["profile"]>;
const policyLabel = {
  existing: "Externally managed",
  managed: "Named managed resource",
  project: "Shared by project",
  worktree: "Dedicated to this worktree",
};

const idleLabel = {
  external: "Lifecycle managed externally",
  "keep-running": "Keeps running when unused",
  "stop-when-unused": "Stops after last consumer",
};
const sourceLabel = {
  branch: "Selected by branch rule",
  default: "Project default",
  override: "Selected for this worktree",
};
const previewLabel = (same: boolean, resourceId: string) => {
  if (same && resourceId) {
    return "Keep connection";
  }
  return resourceId ? "Use assigned instance" : "Create on next start";
};

const Connections = ({
  profile,
  worktree,
  preview = false,
}: {
  profile: Profile;
  worktree: WorktreeSnapshot;
  preview?: boolean;
}) => (
  <div className="flex flex-col gap-3">
    {profile.connections.map((connection) => {
      const group = worktree.appGroups.find(
        (item) => item.id === connection.groupId
      );
      const same =
        worktree.profile?.connections.find(
          (item) => item.groupId === connection.groupId
        )?.resourceId === connection.resourceId;
      return (
        <div key={connection.groupId} className="product-profile-connection">
          <div>
            <strong>{connection.name}</strong>
            <p className="product-muted">{connection.resourceName}</p>
            <p className="product-muted">
              {policyLabel[connection.policy]} · {idleLabel[connection.idle]}
            </p>
            {connection.error ? (
              <p role="alert" className="text-destructive">
                {connection.error}
              </p>
            ) : null}
          </div>
          {preview ? (
            <span className="product-muted">
              {previewLabel(same, connection.resourceId)}
            </span>
          ) : null}
          {!preview && group ? <Status value={appGroupStatus(group)} /> : null}
        </div>
      );
    })}
    {profile.connections.length === 0 ? (
      <p className="product-muted">
        No infrastructure connections. Application instances remain separate for
        each worktree.
      </p>
    ) : null}
  </div>
);

export const WorktreeProfile = ({
  repoPath,
  worktree,
}: {
  repoPath: string;
  worktree: WorktreeSnapshot;
}) => {
  const preview = useCommand("preview-resource-profile", repoPath);
  const change = useCommand("select-resource-profile", repoPath);
  const [selection, setSelection] = useState<{
    id: string | null;
    profile: Profile;
  } | null>(null);
  const { profile } = worktree;
  if (!profile) {
    return null;
  }
  const running = worktree.appGroups.some(
    (group) =>
      group.category !== "infrastructure" && (group.run || group.processRunning)
  );
  const applyLabel = running ? "Apply and restart" : "Apply profile";
  const choose = async (id: string | null) => {
    try {
      change.reset();
      setSelection({
        id,
        profile: await preview.mutateAsync({
          profileId: id,
          repoPath,
          worktreeId: worktree.id,
        }),
      });
    } catch {
      /* Inline error below. */
    }
  };
  const apply = async () => {
    if (!selection) {
      return;
    }
    try {
      await change.mutateAsync({
        profileId: selection.id,
        repoPath,
        restart: running,
        worktreeId: worktree.id,
      });
      setSelection(null);
    } catch {
      /* Keep the dialog open with the operation error. */
    }
  };
  return (
    <section
      className="product-settings-panel my-4"
      aria-label="Resource profile"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Resource profile</h2>
          <p className="product-muted">{sourceLabel[profile.source]}</p>
          <p className="product-muted">
            A preset for infrastructure connections. Your application instance
            stays the same.
          </p>
        </div>
        <Select
          value={profile.id}
          onValueChange={(id) => {
            if (id) {
              choose(id);
            }
          }}
          disabled={preview.isPending || change.isPending}
        >
          <SelectTrigger
            className="max-w-full"
            aria-label="Change resource profile"
          >
            <SelectValue>{profile.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {profile.choices.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {profile.source === "override" ? (
          <Button
            disabled={preview.isPending || change.isPending}
            variant="ghost"
            onClick={() => choose(null)}
          >
            Use branch / project default
          </Button>
        ) : null}
      </div>
      {profile.runningProfile && profile.runningProfile !== profile.id ? (
        <p className="product-muted">
          The application is still using {profile.runningProfile}. Apply this
          profile with a restart to change its connections.
          <Button
            variant="outline"
            disabled={preview.isPending || change.isPending}
            onClick={() => choose(profile.id)}
          >
            Apply with restart
          </Button>
        </p>
      ) : null}
      {preview.isPending ? (
        <output className="product-muted">Preparing connection preview…</output>
      ) : null}
      <Connections profile={profile} worktree={worktree} />
      <ErrorNotice error={preview.error} />
      {selection ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !change.isPending) {
              setSelection(null);
            }
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain">
            <DialogHeader>
              <DialogTitle>Use {selection.profile.name}?</DialogTitle>
              <DialogDescription>
                {running
                  ? "Restart this worktree’s applications with these connections. Shared resources used elsewhere will remain running."
                  : "These connections will be used the next time you start. No services will start now."}
              </DialogDescription>
            </DialogHeader>
            <Connections
              profile={selection.profile}
              worktree={worktree}
              preview
            />
            <p className="product-muted">
              Instance identities are retained. Data retention depends on the
              project’s stop and initialization commands.
            </p>
            <FormFeedback error={change.error} />
            {running && !worktree.configuration.trusted ? (
              <p>
                Review and approve this worktree’s commands before restarting.
              </p>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={change.isPending}
                onClick={() => setSelection(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  change.isPending ||
                  selection.profile.connections.some(
                    (connection) => connection.error
                  ) ||
                  (running && !worktree.configuration.trusted)
                }
                onClick={apply}
              >
                {change.isPending ? "Applying…" : applyLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
};
