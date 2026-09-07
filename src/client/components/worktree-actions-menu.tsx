import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";

import type { WorktreeSnapshot } from "../../controller/workspace-snapshot";
import { appsAreRunning } from "../../controller/workspace-snapshot";
import { worktreeCommandMenuItems } from "../worktree-command-menu";
import type { WorktreeCommandActions } from "../worktree-command-menu";
import { CommandMenuItems } from "./command-menu-items";
import type { CommandMenuItem } from "./command-menu-items";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function WorktreeActionsMenu({
  bordered = false,
  commandActions,
  includeLifecycle = true,
  onDelete,
  onInspect,
  pending,
  worktree,
}: {
  bordered?: boolean;
  commandActions: WorktreeCommandActions;
  includeLifecycle?: boolean;
  onDelete: () => void;
  onInspect: () => void;
  pending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const running = appsAreRunning(worktree);
  const items: CommandMenuItem[] = [
    {
      id: "inspect",
      label: "View details",
      onSelect: onInspect,
    },
    ...worktreeCommandMenuItems({
      actions: commandActions,
      includeLifecycle,
      pending,
      worktree,
    }),
    ...(worktree.isMain
      ? []
      : [
          {
            disabled: pending || running,
            icon: Trash2Icon,
            id: "delete",
            label: "Delete worktree",
            onSelect: onDelete,
            separatorBefore: true,
            variant: "destructive" as const,
          },
        ]),
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${worktree.name}`}
            size="icon"
            variant={bordered ? "outline" : "ghost"}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <CommandMenuItems items={items} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
