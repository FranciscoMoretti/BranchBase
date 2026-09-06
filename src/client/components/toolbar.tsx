import {
  ChevronDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { REFRESH_INTERVAL } from "../queries";
import { BrandMark, BrandWordmark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function repositoryName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function Toolbar({
  activeWorktreeCount,
  activeRepoPath,
  isFetching,
  mainWorktreePath,
  onCreate,
  onConfigure,
  onOpenRepository,
  onRefresh,
  onSelectRepository,
  recentRepositories,
  repoName,
  updatedAt,
  worktreeCount,
}: {
  activeWorktreeCount: number;
  activeRepoPath: string;
  isFetching: boolean;
  mainWorktreePath: string;
  onCreate: () => void;
  onConfigure: () => void;
  onOpenRepository: () => void;
  onRefresh: () => void;
  onSelectRepository: (path: string) => void;
  recentRepositories: string[];
  repoName: string;
  updatedAt: number;
  worktreeCount: number;
}) {
  const style = {
    "--refresh-duration": `${REFRESH_INTERVAL}ms`,
  } as CSSProperties;
  const repositories = [
    activeRepoPath,
    ...recentRepositories.filter((path) => path !== activeRepoPath),
  ];
  return (
    <header className="app-toolbar flex min-h-24 shrink-0 items-center justify-between gap-6 px-5 py-4 max-md:flex-col max-md:items-stretch">
      <div className="toolbar-identity flex min-w-0 items-center gap-4">
        <span className="brand-lockup-mark grid size-11 shrink-0 place-items-center">
          <BrandMark className="size-7" />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <BrandWordmark />
            <span className="brand-slash text-muted-foreground">/</span>
            <strong className="truncate text-sm">{repoName}</strong>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  className="repository-switcher h-6 max-w-[52vw] justify-start px-0"
                  variant="ghost"
                />
              }
            >
              <span>{worktreeCount} worktrees</span>
              <span aria-hidden="true">·</span>
              <span>{activeWorktreeCount} active</span>
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-90">
              <DropdownMenuRadioGroup
                onValueChange={onSelectRepository}
                value={activeRepoPath}
              >
                <DropdownMenuLabel>Recent repositories</DropdownMenuLabel>
                {repositories.map((path) => (
                  <DropdownMenuRadioItem key={path} value={path}>
                    <span className="grid min-w-0 gap-0.5">
                      <strong>{repositoryName(path)}</strong>
                      <small className="truncate text-muted-foreground">
                        {path}
                      </small>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="truncate font-mono font-normal text-muted-foreground">
                {mainWorktreePath}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onConfigure}>
                  <Settings2Icon />
                  Repository configuration…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onOpenRepository}>
                  <FolderOpenIcon />
                  Open another repository…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="toolbar-actions flex shrink-0 items-center gap-1.5">
        <Button onClick={onCreate}>
          <FolderPlusIcon data-icon="inline-start" />
          New worktree
        </Button>
        <Button
          aria-busy={isFetching}
          className="relative w-26 overflow-hidden"
          disabled={isFetching}
          onClick={onRefresh}
          variant="ghost"
        >
          <span
            className="refresh-progress bg-foreground/35"
            key={updatedAt}
            style={style}
          />
          <span className="relative inline-flex items-center gap-1.5">
            <RefreshCwIcon
              className={isFetching ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {isFetching ? "Refreshing" : "Refresh"}
          </span>
        </Button>
        <Button
          aria-label="Repository settings"
          onClick={onConfigure}
          size="icon"
          title="Repository settings"
          variant="ghost"
        >
          <Settings2Icon />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
