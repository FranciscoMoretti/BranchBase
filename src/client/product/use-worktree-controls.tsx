import { useState } from "react";

import { appGroupIsRunning } from "../../project/worktree-status-contract";
import type {
  AppGroupSnapshot,
  WorkspaceSnapshot,
  WorktreeSnapshot,
} from "../../project/worktree-status-contract";
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
import { useRepositoryTrust } from "../use-repository-trust";
import { useWorktreeCommandActions } from "../use-worktree-command-actions";
import type { GroupControls } from "./environment-list";
import { ErrorNotice } from "./primitives";

/** Shared command lifecycle for repository and cross-repository worktree lists. */
export const useWorktreeControls = ({
  data,
  onInspect,
}: {
  data: WorkspaceSnapshot;
  onInspect: GroupControls["inspect"];
}) => {
  const [deleting, setDeleting] = useState<WorktreeSnapshot | null>(null);
  const [shared, setShared] = useState<{
    group: AppGroupSnapshot;
    worktree: WorktreeSnapshot;
    restart: boolean;
  } | null>(null);
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
    blocked: (worktree, group) =>
      Boolean(group.pending) ||
      consumers(group).some((consumer) =>
        actions.appGroupActionBlocked(consumer.id, group.id)
      ) ||
      actions.appGroupActionBlocked(worktree.id, group.id),
    inspect: onInspect,
    restart: (worktree, group) => {
      if (consumers(group).length > 1) {
        setShared({ group, restart: true, worktree });
      } else {
        actions.restartAppGroup(worktree, group);
      }
    },
    retry: actions.retryAppGroup,
    review: (worktree) =>
      trust.requestTrust(
        "Review worktree commands",
        () => {
          // Trust approval does not need a follow-up action.
        },
        {
          approvals: [{ fingerprint: worktree.configuration.trustFingerprint }],
          commands: worktree.configuration.trustCommands,
          trusted: false,
        }
      ),
    toggle: (worktree, group) => {
      if (appGroupIsRunning(group) && consumers(group).length > 1) {
        setShared({ group, restart: false, worktree });
      } else {
        actions.toggleAppGroup(worktree, group);
      }
    },
  };
  return {
    actions,
    controls,
    feedback: (
      <>
        <ErrorNotice error={actions.commands.error} />
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
            onClose={trust.handleDismiss}
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
                  {consumers(shared.group).length} worktrees select this
                  instance. Their connections may be interrupted.{" "}
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
    ),
    onDelete: setDeleting,
    trust,
  };
};
