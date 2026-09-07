import { ShieldCheckIcon } from "lucide-react";

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

const trustButtonLabel = (pending: boolean, actionLabel: string | null) => {
  if (pending) {
    return "Trusting…";
  }
  return actionLabel ? "Trust and continue" : "Trust commands";
};

const dismissButtonLabel = (actionLabel: string | null) =>
  actionLabel ? "Cancel" : "Continue without trusting";

const reviewedCommand = (
  value: string
): {
  command: string;
  description: string;
  label: string;
} => {
  const separator = value.indexOf(": ");
  const label = separator === -1 ? "Command" : value.slice(0, separator);
  const command = separator === -1 ? value : value.slice(separator + 2);
  let description = "Starts the App group.";
  if (label === "Setup") {
    description = "Prepares a newly created worktree.";
  } else if (label.endsWith(" Stop")) {
    description = "Stops the App group with its configured command.";
  }
  return { command, description, label };
};

export const RepositoryTrustDialog = ({
  actionLabel,
  commands,
  error,
  onClose,
  onTrust,
  open,
  pending,
  repoPath,
}: {
  actionLabel: string | null;
  commands: string[];
  error: Error | null;
  onClose: () => void;
  onTrust: () => Promise<void>;
  open: boolean;
  pending: boolean;
  repoPath: string;
}) => (
  <Dialog
    onOpenChange={(nextOpen) => {
      if (!(nextOpen || pending)) {
        onClose();
      }
    }}
    open={open}
  >
    <DialogContent className="sm:max-w-lg" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Trust repository commands?</DialogTitle>
        <DialogDescription>
          {actionLabel ? (
            <>
              To {actionLabel.toLowerCase()}, BranchBase needs permission to run
              this repository&apos;s configured commands.
            </>
          ) : (
            <>
              BranchBase opened this repository in restricted mode. You can
              inspect it, but configured commands will not run until you trust
              them.
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <code className="bg-muted text-muted-foreground px-2 py-1.5 break-all">
        {repoPath}
      </code>
      <div className="divide-y">
        {commands.map((value) => {
          const item = reviewedCommand(value);
          return (
            <section
              className="space-y-2 py-3 first:pt-0 last:pb-0"
              key={value}
            >
              <div className="space-y-0.5">
                <h3 className="font-medium">{item.label}</h3>
                <p className="text-muted-foreground">{item.description}</p>
              </div>
              <code className="bg-muted block px-2 py-1.5 break-all">
                {item.command}
              </code>
            </section>
          );
        })}
      </div>
      <p className="text-muted-foreground">
        Trust is saved for this command fingerprint. BranchBase asks again if
        the configured commands change.
      </p>
      <FormFeedback error={error} title="Could not approve commands" />
      <DialogFooter>
        <Button disabled={pending} onClick={onClose} variant="outline">
          {dismissButtonLabel(actionLabel)}
        </Button>
        <Button disabled={pending} onClick={onTrust}>
          <ShieldCheckIcon data-icon="inline-start" />
          {trustButtonLabel(pending, actionLabel)}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
