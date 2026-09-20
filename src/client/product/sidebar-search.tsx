import { FolderGit2Icon, GitBranchIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProjectOverview } from "../../project/catalog-contract";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { QueryContent } from "./async-state";
import type { QueryState } from "./async-state";
import { navigationResults } from "./navigation-search";
import type { NavigationResult } from "./navigation-search";

export type SearchCatalog = Omit<QueryState, "data"> & {
  data: ProjectOverview[] | undefined;
};

const SearchResult = ({
  result,
  dismiss,
}: {
  result: NavigationResult;
  dismiss: () => void;
}) => {
  const link = useRef<HTMLAnchorElement>(null);
  const clicking = useRef(false);
  return (
    <CommandItem
      asChild
      value={result.href}
      onSelect={() => {
        // Keyboard selection follows the real link through the app's navigation
        // guard. Pointer clicks keep their native modifiers and must not replay.
        if (!clicking.current) {
          link.current?.click();
        }
      }}
    >
      <a
        href={result.href}
        ref={link}
        onClickCapture={() => {
          clicking.current = true;
          queueMicrotask(() => {
            clicking.current = false;
          });
        }}
        onClick={dismiss}
      >
        {result.kind === "repository" ? <FolderGit2Icon /> : <GitBranchIcon />}
        <span>
          <strong>{result.label}</strong>
          <small>{result.detail}</small>
        </span>
        <span className="product-search-kind">
          {result.kind === "repository" ? "Repository" : "Worktree"}
        </span>
      </a>
    </CommandItem>
  );
};

export const SidebarSearch = ({ projects }: { projects: SearchCatalog }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = navigationResults(projects.data ?? [], query);
  const resultCount = groups.reduce(
    (count, group) => count + group.results.length,
    0
  );
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
    }
  };
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
  return (
    <SidebarMenuItem>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger
          render={
            <SidebarMenuButton tooltip="Find repositories and worktrees" />
          }
          aria-label="Find repositories and worktrees"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <SearchIcon />
          <span>Find...</span>
          <kbd className="product-search-shortcut">⌘K</kbd>
        </DialogTrigger>
        <DialogContent
          className="product-navigation-search"
          initialFocus={inputRef}
        >
          <DialogHeader>
            <DialogTitle>Jump to a repository or worktree</DialogTitle>
            <DialogDescription>
              Search by name, branch, or path. Use ↑ ↓ to choose and Enter to
              open.
            </DialogDescription>
          </DialogHeader>
          <QueryContent label="Repositories" query={projects} compact>
            <Command
              shouldFilter={false}
              loop
              label="Search repositories and worktrees"
              vimBindings={false}
            >
              <CommandInput
                ref={inputRef}
                placeholder="Find repositories or worktrees…"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList
                className="product-search-results"
                label="Repositories and worktrees"
              >
                {groups.length ? (
                  groups.map((group) => (
                    <CommandGroup heading={group.name} key={group.path}>
                      {group.results.map((result) => (
                        <SearchResult
                          key={result.href}
                          result={result}
                          dismiss={() => {
                            changeOpen(false);
                            setOpenMobile(false);
                          }}
                        />
                      ))}
                    </CommandGroup>
                  ))
                ) : (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>
                        {projects.data?.length
                          ? "No matches"
                          : "No repositories yet"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {projects.data?.length
                          ? "Try a different repository, branch, or path."
                          : "Add a repository to find it and its worktrees here."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CommandList>
              <p className="product-search-count" aria-live="polite">
                {resultCount} {resultCount === 1 ? "result" : "results"}
                {projects.error ? " · Last known catalog" : ""}
              </p>
            </Command>
          </QueryContent>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
};
