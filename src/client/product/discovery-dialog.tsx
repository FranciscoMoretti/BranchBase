import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "../components/ui/alert";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { useCommand } from "../mutations";
import { useRepositoryPicker } from "../use-repository-picker";
import { FormFeedback, QueryContent } from "./async-state";
import { useDevelopmentFolders, useProductCommand } from "./data";

export const DiscoveryDialog = ({
  onClose,
  initialKind = "project",
}: {
  onClose: () => void;
  initialKind?: string;
}) => {
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
        <FieldGroup>
          <Field data-disabled={pending}>
            <ToggleGroup
              aria-label="Add type"
              disabled={pending}
              value={[kind]}
              variant="outline"
              onValueChange={(values) => {
                if (values[0]) {
                  setKind(values[0]);
                  command.reset();
                }
              }}
            >
              {[
                ["project", "Single project"],
                ["folder", "Development folder"],
              ].map(([value, label]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {kind === "folder"
                ? "Choose a folder containing Git repositories. BranchBase scans up to three levels, skips dependencies, and discovers new projects while you use the app."
                : "Choose an existing Git repository. Its linked worktrees are included, even when they live elsewhere."}
            </FieldDescription>
          </Field>
          <Field data-disabled={pending}>
            <FieldLabel htmlFor="discovery-path">
              {kind === "folder"
                ? "Development folder path"
                : "Repository path"}
            </FieldLabel>
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
                  kind === "folder"
                    ? "/Users/you/Code"
                    : "/Users/you/Code/project"
                }
                value={path}
              />
              <Button
                disabled={pending}
                onClick={() => picker.handleBrowse()}
                variant="outline"
              >
                <FolderOpenIcon data-icon="inline-start" />
                Browse
              </Button>
            </div>
          </Field>
        </FieldGroup>
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
};
const DevelopmentFolderRow = ({
  folder,
}: {
  folder: NonNullable<ReturnType<typeof useDevelopmentFolders>["data"]>[number];
}) => {
  const remove = useCommand("remove-development-folder");
  return (
    <div className="product-setting-row">
      <div className="min-w-0">
        <p className="font-medium break-all">{folder.path}</p>
        <p className="product-muted">
          {folder.projectsFound} repositories found ·{" "}
          {folder.lastScannedAt
            ? `Scanned ${new Date(folder.lastScannedAt).toLocaleTimeString()}`
            : "Not yet scanned"}
        </p>
        {remove.error ? (
          <FormFeedback error={remove.error} title="Could not remove folder" />
        ) : null}
        {folder.warning ? (
          <Alert>
            <AlertDescription>{folder.warning}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <Button
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate({
            repoPath: folder.path,
          })
        }
        variant="ghost"
      >
        {remove.isPending ? "Removing…" : "Remove"}
      </Button>
    </div>
  );
};

export const DevelopmentFoldersControls = ({
  onAdd,
}: {
  onAdd: () => void;
}) => {
  const folders = useDevelopmentFolders();
  const command = useCommand("scan-development-folders");
  return (
    <div className="product-folder-settings">
      <QueryContent label="Development folders" query={folders}>
        {folders.data?.map((folder) => (
          <DevelopmentFolderRow folder={folder} key={folder.path} />
        ))}
        {folders.data?.length === 0 ? (
          <p className="product-muted">
            Add a development folder to discover its projects automatically.
          </p>
        ) : null}
      </QueryContent>
      <FormFeedback
        error={command.error}
        title="Could not scan development folders"
      />
      <div className="product-actions">
        <Button
          disabled={command.isPending || !folders.data?.length}
          onClick={() => command.mutate({})}
          variant="outline"
        >
          <RefreshCwIcon />
          {command.isPending ? "Scanning…" : "Scan now"}
        </Button>
        <Button onClick={onAdd}>Add folder</Button>
      </div>{" "}
    </div>
  );
};
