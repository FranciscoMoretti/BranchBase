import type { UseMutationResult } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import type { CommandReceipt } from "../../controller/workspace-snapshot";
import { FormFeedback } from "../product/async-state";
import type { RequestRepositoryTrust } from "../use-repository-trust";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type CreateWorktreeInput = Record<string, unknown> & { repoPath: string };

export function CreateWorktreeDialog({
  mutation,
  onClose,
  repoPath,
  requestRepositoryTrust,
}: {
  mutation: UseMutationResult<CommandReceipt, Error, CreateWorktreeInput>;
  onClose: () => void;
  repoPath: string;
  requestRepositoryTrust: RequestRepositoryTrust;
}) {
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(input: CreateWorktreeInput) {
    try {
      setError(null);
      await mutation.mutateAsync(input);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create worktree"
      );
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!branch.trim()) {
      setError("Branch is required.");
      return;
    }
    if (!folderName.trim()) {
      setError("Folder name is required.");
      return;
    }
    requestRepositoryTrust("Create this worktree and run setup", () =>
      create({
        branch: branch.trim(),
        createBranch,
        folderName: folderName.trim(),
        repoPath,
      })
    );
  }

  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>New worktree</DialogTitle>
          <DialogDescription>
            Create a linked worktree and run the repository&apos;s setup
            command. App endpoints are assigned automatically when started.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-worktree-branch">Branch</FieldLabel>
              <Input
                autoFocus
                disabled={mutation.isPending}
                id="new-worktree-branch"
                onChange={(event) => setBranch(event.target.value)}
                placeholder="feature/my-branch"
                value={branch}
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                checked={createBranch}
                disabled={mutation.isPending}
                id="new-worktree-create-branch"
                onCheckedChange={(checked) => setCreateBranch(checked === true)}
              />
              <FieldLabel htmlFor="new-worktree-create-branch">
                Create a new branch
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-worktree-folder">Folder name</FieldLabel>
              <Input
                disabled={mutation.isPending}
                id="new-worktree-folder"
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="my-worktree"
                value={folderName}
              />
              <FieldDescription>
                Choose the sibling folder where Git will create the worktree.
              </FieldDescription>
            </Field>
            <FormFeedback
              error={error ? new Error(error) : null}
              title="Could not create worktree"
            />
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                mutation.isPending || !branch.trim() || !folderName.trim()
              }
              type="submit"
            >
              {mutation.isPending ? "Creating…" : "Create worktree"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
