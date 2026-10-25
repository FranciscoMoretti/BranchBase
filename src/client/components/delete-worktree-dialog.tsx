import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import type {
  BranchBaseCommandInput,
  BranchBaseCommandResult,
} from "../../application/command-contract";
import type { DiskUsage } from "../../project/disk-usage-contract";
import { FormFeedback } from "../product/async-state";
import { formatBytes } from "../product/resource-format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export const DeleteWorktreeDialog = ({
  mutation,
  onClose,
  repoPath,
  worktree,
  disk,
}: {
  mutation: UseMutationResult<
    BranchBaseCommandResult<"delete-worktree">,
    Error,
    BranchBaseCommandInput<"delete-worktree">
  >;
  onClose: () => void;
  repoPath: string;
  worktree: { id: string; path: string; primaryAppGroup?: string };
  disk?: DiskUsage;
}) => {
  const [message, setMessage] = useState<string | null>(null);
  const confirm = async () => {
    try {
      setMessage(null);
      await mutation.mutateAsync({
        appGroupName: worktree.primaryAppGroup,
        repoPath,
        worktreeId: worktree.id,
      });
      onClose();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not delete worktree"
      );
    }
  };
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!(nextOpen || mutation.isPending)) {
          onClose();
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worktree?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove this linked Git worktree from the repository.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <code className="path-callout">{worktree.path}</code>
        {disk?.bytes !== null && disk?.bytes !== undefined ? (
          <p className="text-sm">
            Disk: {formatBytes(disk.bytes)} measured. Space freed may be lower
            because files can share storage.
          </p>
        ) : null}
        <p className="hint text-xs/relaxed">
          Git will refuse if the worktree has uncommitted changes. Brum never
          forces removal. Ignored files, including dependencies, build output,
          and any ignored local data, will also be deleted. The Git branch is
          kept.
        </p>
        <FormFeedback
          error={message ? new Error(message) : null}
          title="Could not remove worktree"
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={confirm}
            variant="destructive"
          >
            {mutation.isPending ? "Deleting…" : "Delete worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
