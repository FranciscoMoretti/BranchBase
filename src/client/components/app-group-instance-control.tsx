import { PlusIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import type { AppGroupSnapshot } from "../../controller/workspace-snapshot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function AppGroupInstanceControl({
  disabled,
  group,
  onCreate,
  onSelect,
}: {
  disabled: boolean;
  group: AppGroupSnapshot;
  onCreate: (name: string) => Promise<void>;
  onSelect: (instanceId: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");

  if (group.instance.mode !== "selectable") {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    try {
      await onCreate(trimmedName);
      setName("");
      setDialogOpen(false);
    } catch {
      // The workspace command alert presents the mutation error. Keep this
      // dialog and its input intact so the user can correct the name.
    }
  }

  return (
    <div className="flex min-w-0 items-center">
      <Select
        disabled={disabled}
        onValueChange={(value) => {
          if (value && value !== group.instance.id) {
            onSelect(value);
          }
        }}
        value={group.instance.id}
      >
        <SelectTrigger
          aria-label={`Selected ${group.name} instance`}
          className="h-7 min-w-0 flex-1 border-r-0"
          size="sm"
        >
          <SelectValue>{group.instance.name}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            {group.instances.map((instance) => (
              <SelectItem key={instance.id} value={instance.id}>
                <span
                  className={
                    instance.running
                      ? "size-1.5 rounded-full bg-emerald-500"
                      : "bg-muted-foreground/50 size-1.5 rounded-full"
                  }
                />
                {instance.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogTrigger
          disabled={disabled}
          render={
            <Button
              aria-label={`Create ${group.name} instance`}
              className="shrink-0"
              size="icon-sm"
              variant="outline"
            />
          }
        >
          <PlusIcon />
        </DialogTrigger>
        <DialogContent>
          <form className="grid gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New {group.name} instance</DialogTitle>
              <DialogDescription>
                Create a named instance with its own stable ports, then use it
                for this worktree.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`instance-name-${group.id}`}>
                  Instance name
                </FieldLabel>
                <Input
                  autoFocus
                  id={`instance-name-${group.id}`}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Migration experiment"
                  value={name}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button disabled={!name.trim() || disabled} type="submit">
                Create and use
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
