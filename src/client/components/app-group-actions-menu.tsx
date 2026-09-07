import {
  MoreHorizontalIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";

import type {
  AppGroupSnapshot,
  WorktreeSnapshot,
} from "../../controller/workspace-snapshot";
import {
  appGroupCanRestart,
  appGroupIsRunning,
} from "../../controller/workspace-snapshot";
import { CommandMenuItems } from "./command-menu-items";
import type { CommandMenuItem } from "./command-menu-items";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function appGroupCommandMenuItems({
  group,
  onRestart,
  onRetry,
  onToggle,
  pending,
}: {
  group: AppGroupSnapshot;
  onRestart: () => void;
  onRetry: () => void;
  onToggle: () => void;
  pending: boolean;
}): CommandMenuItem[] {
  const running = appGroupIsRunning(group);
  const retryable =
    group.cleanupOnly !== true &&
    running &&
    (group.health !== "running" ||
      group.apps.some((app) => app.routeState === "unavailable"));
  return [
    {
      disabled: pending,
      icon: running ? SquareIcon : PlayIcon,
      id: running ? "stop" : "start",
      label: running ? `Stop ${group.name}` : `Start ${group.name}`,
      onSelect: onToggle,
    },
    ...(retryable
      ? [
          {
            disabled: pending,
            icon: RefreshCwIcon,
            id: "retry",
            label: `Retry ${group.name} readiness and routes`,
            onSelect: onRetry,
          },
        ]
      : []),
    ...(appGroupCanRestart(group)
      ? [
          {
            disabled: pending,
            icon: RotateCwIcon,
            id: "restart",
            label: `Restart ${group.name}`,
            onSelect: onRestart,
          },
        ]
      : []),
  ];
}

export function AppGroupActionsMenu({
  group,
  onRestart,
  onRetry,
  onToggle,
  pending,
  worktree,
}: {
  group: AppGroupSnapshot;
  onRestart: () => void;
  onRetry: () => void;
  onToggle: () => void;
  pending: boolean;
  worktree: WorktreeSnapshot;
}) {
  const items = appGroupCommandMenuItems({
    group,
    onRestart,
    onRetry,
    onToggle,
    pending,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Actions for ${group.name} in ${worktree.name}`}
            disabled={pending}
            size="icon"
            variant="ghost"
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
