import { FolderGit2Icon, GitBranchIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { ProjectOverview } from "../../project/catalog-contract";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { navigationResults } from "./navigation-search";

export const SidebarSearch = ({
  projects,
}: {
  projects: ProjectOverview[];
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const groups = navigationResults(projects, query);
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
  const resultLinks = () => [
    ...(resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ??
      []),
  ];
  const moveFocus = (
    event: KeyboardEvent<HTMLInputElement | HTMLAnchorElement>
  ) => {
    const links = resultLinks();
    if (!links.length) {
      return;
    }
    if (event.key === "Enter" && event.currentTarget === inputRef.current) {
      event.preventDefault();
      links[0]?.click();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const current =
      event.currentTarget instanceof HTMLAnchorElement
        ? links.indexOf(event.currentTarget)
        : -1;
    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
    if (current === -1 && event.key === "ArrowUp") {
      links.at(-1)?.focus();
    } else if (next < 0 || next >= links.length) {
      inputRef.current?.focus();
    } else {
      links[next]?.focus();
    }
  };
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
          <InputGroup>
            <InputGroupInput
              id={inputId}
              ref={inputRef}
              aria-label="Search repositories and worktrees"
              placeholder="Find repositories or worktrees…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={moveFocus}
            />
            <InputGroupAddon htmlFor={inputId}>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
          <div className="product-search-results" ref={resultsRef}>
            {groups.length ? (
              groups.map((group) => (
                <section aria-label={group.name} key={group.path}>
                  <h3>{group.name}</h3>
                  <ul>
                    {group.results.map((result) => (
                      <li key={result.href}>
                        <a
                          href={result.href}
                          onKeyDown={moveFocus}
                          onClick={() => {
                            changeOpen(false);
                            setOpenMobile(false);
                          }}
                        >
                          {result.kind === "repository" ? (
                            <FolderGit2Icon />
                          ) : (
                            <GitBranchIcon />
                          )}
                          <span>
                            <strong>{result.label}</strong>
                            <small>{result.detail}</small>
                          </span>
                          <span className="product-search-kind">
                            {result.kind === "repository"
                              ? "Repository"
                              : "Worktree"}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {query ? "No matches" : "No repositories yet"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Try a different repository, branch, or path."
                      : "Add a repository to find it and its worktrees here."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          <p className="product-search-count" aria-live="polite">
            {groups.reduce((count, group) => count + group.results.length, 0)}{" "}
            {groups.reduce(
              (count, group) => count + group.results.length,
              0
            ) === 1
              ? "result"
              : "results"}
          </p>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
};
