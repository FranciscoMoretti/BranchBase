import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import type { WorkspaceSnapshot } from "../../controller/workspace-snapshot";
import { FormFeedback } from "../product/async-state";
import { useRepositoryOpen } from "../use-repository-open";
import { useRepositoryPicker } from "../use-repository-picker";
import { useRepositorySetup } from "../use-repository-setup";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export function RepositoryDialog({
  currentPath,
  onClose,
  onConfirm,
}: {
  currentPath: string;
  onClose: () => void;
  onConfirm: (
    path: string,
    snapshot: WorkspaceSnapshot
  ) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(currentPath);
  const opener = useRepositoryOpen(async (path, snapshot) => {
    await onConfirm(path, snapshot);
    onClose();
  });
  function changeDraft(path: string) {
    opener.clearError();
    picker.clearError();
    setDraft(path);
  }
  async function openSelected(path: string) {
    changeDraft(path);
    await opener.open(path);
  }
  const picker = useRepositoryPicker(openSelected);
  const setup = useRepositorySetup({
    error: opener.error,
    onCreated: () => opener.open(draft.trim()),
    repoPath: draft.trim(),
  });

  async function confirm() {
    const path = draft.trim();
    if (!path) {
      return;
    }
    await opener.open(path);
  }
  function feedback() {
    if (setup.active) {
      return setup.notice();
    }
    const message = opener.error?.message ?? picker.error;
    return (
      <FormFeedback
        error={message ? new Error(message) : null}
        title="Could not open project"
      />
    );
  }

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose();
          }
        }}
        open
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-auto">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {currentPath ? "Change repository" : "Add project"}
            </DialogTitle>
            <DialogDescription>
              {currentPath
                ? "The current repository stays open until the replacement has been verified."
                : "Choose an existing Git repository. BranchBase discovers its worktrees and configured app groups."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="change-repository-path">
                Repository path
              </FieldLabel>
              <div className="repository-path-control">
                <Input
                  disabled={opener.pending || picker.pending}
                  id="change-repository-path"
                  onChange={(event) => changeDraft(event.target.value)}
                  value={draft}
                />
                <Button
                  aria-label="Choose repository folder"
                  disabled={opener.pending || picker.pending}
                  onClick={picker.browse}
                  variant="outline"
                >
                  <FolderOpenIcon data-icon="inline-start" />
                  {picker.pending ? "Opening…" : "Browse"}
                </Button>
              </div>
            </Field>
            {feedback()}
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={opener.pending}
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                opener.pending ||
                picker.pending ||
                draft.trim() === "" ||
                draft === currentPath
              }
              onClick={confirm}
            >
              {opener.pending ? "Checking…" : "Open repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {setup.dialog}
    </>
  );
}
