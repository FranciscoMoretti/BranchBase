import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useRepositoryPicker } from "../use-repository-picker";
import { FormFeedback, QueryContent } from "./async-state";
import { useDevelopmentFolders, useProductCommand } from "./data";
import { ErrorNotice } from "./primitives";

export function DiscoveryDialog({
  onClose,
  initialKind = "project",
}: {
  onClose: () => void;
  initialKind?: string;
}) {
  const [kind, setKind] = useState(initialKind);
  const [path, setPath] = useState("");
  const command = useProductCommand();
  const picker = useRepositoryPicker((selectedPath) => {
    setPath(selectedPath);
    command.reset();
  });
  const pending = command.isPending || picker.pending;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || pending)) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to BranchBase</DialogTitle>
          <DialogDescription>
            Discover worktrees and what they have running. No configuration
            required.
          </DialogDescription>
        </DialogHeader>
        <fieldset aria-label="Add type" className="product-filter-options">
          {[
            ["project", "Single project"],
            ["folder", "Development folder"],
          ].map(([value, label]) => (
            <Button
              aria-pressed={kind === value}
              disabled={pending}
              key={value}
              onClick={() => {
                setKind(value);
                command.reset();
              }}
              variant="ghost"
            >
              {label}
            </Button>
          ))}
        </fieldset>
        <p className="product-muted product-discovery-help">
          {kind === "folder"
            ? "Choose a folder containing Git repositories. BranchBase scans up to three levels, skips dependencies, and discovers new projects while you use the app."
            : "Choose an existing Git repository. Its linked worktrees are included, even when they live elsewhere."}
        </p>
        <label htmlFor="discovery-path">
          {kind === "folder" ? "Development folder path" : "Repository path"}
        </label>
        <div className="repository-path-control">
          <Input
            disabled={pending}
            id="discovery-path"
            onChange={(event) => {
              setPath(event.target.value);
              command.reset();
              picker.clearError();
            }}
            placeholder={
              kind === "folder" ? "/Users/you/Code" : "/Users/you/Code/project"
            }
            value={path}
          />
          <Button disabled={pending} onClick={picker.browse} variant="outline">
            <FolderOpenIcon />
            Browse
          </Button>
        </div>
        <FormFeedback
          error={
            command.error ?? (picker.error ? new Error(picker.error) : null)
          }
          title={
            kind === "folder" ? "Could not add folder" : "Could not add project"
          }
        />
        <DialogFooter>
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!path.trim() || pending}
            onClick={async () => {
              try {
                await command.mutateAsync({
                  command:
                    kind === "folder"
                      ? "add-development-folder"
                      : "save-project",
                  repoPath: path.trim(),
                });
                onClose();
              } catch {
                /* Form feedback stays visible. */
              }
            }}
          >
            {command.isPending ? "Discovering…" : "Add and discover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function DevelopmentFoldersControls({ onAdd }: { onAdd: () => void }) {
  const folders = useDevelopmentFolders();
  const command = useProductCommand();
  return (
    <div className="product-folder-settings">
      <QueryContent label="Development folders" query={folders}>
        {folders.data?.map((folder) => (
          <div className="product-setting-row" key={folder.path}>
            <div className="min-w-0">
              <p className="font-medium break-all">{folder.path}</p>
              <p className="product-muted">
                {folder.projectsFound} repositories found ·{" "}
                {folder.lastScannedAt
                  ? `Scanned ${new Date(folder.lastScannedAt).toLocaleTimeString()}`
                  : "Not yet scanned"}
              </p>
              {folder.warning ? (
                <p className="product-warning">{folder.warning}</p>
              ) : null}
            </div>
            <Button
              disabled={command.isPending}
              onClick={() =>
                command.mutate({
                  command: "remove-development-folder",
                  repoPath: folder.path,
                })
              }
              variant="ghost"
            >
              Remove
            </Button>
          </div>
        ))}
        {folders.data?.length === 0 ? (
          <p className="product-muted">
            Add a development folder to discover its projects automatically.
          </p>
        ) : null}
      </QueryContent>
      <ErrorNotice
        error={command.error}
        title="Could not update development folders"
      />
      <div className="product-actions">
        <Button
          disabled={command.isPending || !folders.data?.length}
          onClick={() =>
            command.mutate({ command: "scan-development-folders" })
          }
          variant="outline"
        >
          <RefreshCwIcon />
          {command.isPending ? "Scanning…" : "Scan now"}
        </Button>
        <Button onClick={onAdd}>Add folder</Button>
      </div>{" "}
    </div>
  );
}
