import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2Icon } from "lucide-react";

import { initializeRepository, previewRepositoryConfig } from "../api";
import { FormFeedback } from "../product/async-state";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export const RepositoryInitializeDialog = ({
  onClose,
  onCreated,
  repoPath,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  repoPath: string;
}) => {
  const preview = useQuery({
    queryFn: () => previewRepositoryConfig(repoPath),
    queryKey: ["repository-initialization", repoPath],
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => initializeRepository(repoPath),
    onSuccess: onCreated,
  });
  const error = preview.error ?? create.error;
  return (
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
          <DialogTitle>Initialize BranchBase</DialogTitle>
          <DialogDescription>
            Review the detected settings before creating .branchbase.json.
          </DialogDescription>
        </DialogHeader>
        <div className="modal-copy initialize-copy">
          <div className="initialize-intro">
            <FilePlus2Icon />
            <div>
              <strong>Create a starter worktree configuration</strong>
              <p>
                BranchBase detected this repository and prepared a conservative
                single-app configuration. Creating this file does not approve or
                run its commands.
              </p>
            </div>
          </div>
          {preview.data ? (
            <>
              <dl className="detection-grid">
                <div>
                  <dt>Detected project</dt>
                  <dd>{preview.data.detectedRuntime}</dd>
                </div>
                <div>
                  <dt>Setup command</dt>
                  <dd>{preview.data.detectedSetupCommand ?? "Not detected"}</dd>
                </div>
                <div>
                  <dt>Start command</dt>
                  <dd>{preview.data.detectedStartCommand ?? "Not detected"}</dd>
                </div>
              </dl>
              {preview.data.detectedStartCommand ? null : (
                <p className="setup-warning">
                  No start command was detected. The preview contains starter
                  commands; edit them in Settings before approving or running
                  this project.
                </p>
              )}
              <pre className="config-preview">
                {JSON.stringify(preview.data.config, null, 2)}
              </pre>
              <code className="config-destination">
                {preview.data.configPath}
              </code>
            </>
          ) : null}
          {preview.isLoading ? <p>Inspecting repository…</p> : null}
          <FormFeedback error={error} title="Could not initialize project" />
        </div>
        <DialogFooter>
          <Button
            disabled={create.isPending}
            onClick={onClose}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!preview.data || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
