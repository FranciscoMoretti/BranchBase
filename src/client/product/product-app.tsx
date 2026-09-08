import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { runCommand } from "../api";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useWorkspace } from "../queries";
import { ActivityPage } from "./activity-page";
import { QueryContent } from "./async-state";
import { hrefFor, readLocation, useObservation, useProjects } from "./data";
import type { ProductLocation } from "./data";
import { ObservedProjectPage } from "./observed-project-page";
import { Blank, Shell } from "./primitives";
import { ProjectsPage } from "./projects-page";
import { BranchBaseSettings } from "./settings-page";

const WorkspacePage = lazy(async () => {
  const module = await import("./workspace-page");
  return { default: module.WorkspacePage };
});

const HISTORY_INDEX = "branchbaseHistoryIndex";

const readHistoryIndex = (state: unknown): number | null => {
  if (
    state &&
    typeof state === "object" &&
    HISTORY_INDEX in state &&
    typeof state[HISTORY_INDEX as keyof typeof state] === "number"
  ) {
    return state[HISTORY_INDEX as keyof typeof state] as number;
  }
  return null;
};

interface PendingNavigation {
  fallback?: boolean;
  href: string;
  traversal?: { delta: number; targetIndex: number };
}

export const ProductApp = () => {
  const [location, setLocation] = useState(readLocation);
  const observation = useObservation(location.repo);
  const workspace = useWorkspace(
    location.repo,
    observation.data?.configured === true
  );
  const projects = useProjects();
  const client = useQueryClient();
  const dirty = useRef(false);
  const historyInitialized = useRef(false);
  const historyIndex = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (historyInitialized.current) {
      return;
    }
    const existingIndex = readHistoryIndex(window.history.state);
    historyIndex.current = existingIndex ?? 0;
    if (existingIndex === null) {
      window.history.replaceState(
        { ...window.history.state, [HISTORY_INDEX]: historyIndex.current },
        "",
        window.location.href
      );
    }
    historyInitialized.current = true;
  }, []);
  const historyAction = useRef<{
    kind: "restore" | "accept";
    index: number;
  } | null>(null);
  const currentHref = useRef(window.location.href);
  const scrollPositions = useRef(new Map<string, number>());
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pendingNavigation = useRef<PendingNavigation | null>(null);
  const go = useCallback((href: string) => {
    scrollPositions.current.set(currentHref.current, window.scrollY);
    const nextIndex = (historyIndex.current ?? -1) + 1;
    window.history.pushState(
      { ...window.history.state, [HISTORY_INDEX]: nextIndex },
      "",
      href
    );
    historyIndex.current = nextIndex;
    currentHref.current = window.location.href;
    setLocation(readLocation());
  }, []);
  const requestNavigation = useCallback(
    (href: string) => {
      if (dirty.current) {
        setPendingHref(href);
      } else {
        go(href);
      }
    },
    [go]
  );
  const navigate = useCallback(
    (value: Partial<ProductLocation>) => {
      requestNavigation(hrefFor(value));
    },
    [requestNavigation]
  );
  useEffect(() => {
    const setDirty = (event: Event) => {
      const { detail } = event as CustomEvent<boolean>;
      if (typeof detail === "boolean") {
        dirty.current = detail;
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = true;
      }
    };
    const sync = () => {
      scrollPositions.current.set(currentHref.current, window.scrollY);
      const target = window.location.href;
      const targetIndex = readHistoryIndex(window.history.state);
      const action = historyAction.current;
      if (action && targetIndex === action.index) {
        historyAction.current = null;
        if (action.kind === "restore") {
          return;
        }
        historyIndex.current = targetIndex;
        currentHref.current = target;
        setLocation(readLocation());
        return;
      }
      if (dirty.current) {
        const currentIndex = historyIndex.current;
        if (
          currentIndex !== null &&
          targetIndex !== null &&
          targetIndex !== currentIndex
        ) {
          pendingNavigation.current = {
            href: target,
            traversal: {
              delta: targetIndex - currentIndex,
              targetIndex,
            },
          };
          historyAction.current = { index: currentIndex, kind: "restore" };
          setPendingHref(target);
          window.history.go(currentIndex - targetIndex);
          return;
        }
        // Untagged entries have no safe traversal delta. Keep the dirty app
        // visible and require an explicit full navigation to discard it.
        window.history.replaceState(
          { ...window.history.state, [HISTORY_INDEX]: currentIndex ?? 0 },
          "",
          currentHref.current
        );
        pendingNavigation.current = { fallback: true, href: target };
        setPendingHref(target);
        return;
      }
      historyIndex.current = targetIndex;
      currentHref.current = target;
      setLocation(readLocation());
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.target || anchor.hasAttribute("download")) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== "/") {
        return;
      }
      event.preventDefault();
      requestNavigation(url.href);
    };
    window.addEventListener("branchbase:settings-dirty", setDirty);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", sync);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("branchbase:settings-dirty", setDirty);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", sync);
      document.removeEventListener("click", click);
    };
  }, [requestNavigation]);
  useEffect(() => {
    let paths: string[];
    try {
      if (localStorage.getItem("branchbase:projects-migrated")) {
        return;
      }
      const value: unknown = JSON.parse(
        localStorage.getItem("branchbase:recent-repos") ?? "[]"
      );
      paths = Array.isArray(value)
        ? value
            .filter(
              (item): item is string =>
                typeof item === "string" && item.length > 0
            )
            .slice(0, 5)
        : [];
    } catch {
      return;
    }
    void (async () => {
      try {
        await Promise.all(
          paths.map((repoPath) => runCommand("save-project", { repoPath }))
        );
        localStorage.setItem("branchbase:projects-migrated", "1");
        await client.invalidateQueries({ queryKey: ["projects"] });
      } catch {
        // Migration retries on the next mount when the API is unavailable.
      }
    })();
  }, [client]);
  const inspectedPath = observation.data?.repoPath;
  useEffect(() => {
    if (location.repo && !inspectedPath) {
      return;
    }
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        behavior: "instant",
        top: scrollPositions.current.get(window.location.href) ?? 0,
      })
    );
    return () => cancelAnimationFrame(frame);
  }, [location, inspectedPath]);
  useEffect(() => {
    if (
      !(inspectedPath && projects.data) ||
      projects.data.some((item) => item.path === inspectedPath)
    ) {
      return;
    }
    void (async () => {
      try {
        await runCommand("save-project", { repoPath: inspectedPath });
        await client.invalidateQueries({ queryKey: ["projects"] });
      } catch {
        // The next observation retries saving this project.
      }
    })();
  }, [inspectedPath, client, projects.data]);
  const project = projects.data?.find(
    (item) =>
      item.path === workspace.data?.repoPath || item.path === location.repo
  );
  let content: ReactNode;
  if (location.view === "machine") {
    content = <BranchBaseSettings />;
  } else if (!location.repo) {
    content =
      location.view === "activity" ? <ActivityPage /> : <ProjectsPage />;
  } else if (observation.data && !observation.data.configured) {
    content = (
      <ObservedProjectPage
        data={observation.data}
        key={observation.data.repoPath}
        location={location}
        project={project}
      />
    );
  } else if (workspace.data) {
    content = (
      <WorkspacePage
        data={workspace.data}
        key={workspace.data.repoPath}
        location={location}
        navigate={navigate}
        observation={observation.data}
        project={project}
        refresh={() => {
          workspace.refetch();
        }}
      />
    );
  } else {
    content = null;
  }
  const workspaceView = location.repo && location.view !== "machine";

  const projectQuery = observation.data?.configured
    ? {
        ...workspace,
        error: observation.error ?? workspace.error,
        isFetching: observation.isFetching || workspace.isFetching,
      }
    : observation;

  return (
    <Shell location={location} name={project?.name ?? workspace.data?.repoName}>
      <Suspense
        fallback={
          <Blank
            description="Preparing the environment controls."
            title="Loading workspace"
          />
        }
      >
        {workspaceView ? (
          <QueryContent
            key={location.repo}
            label="Project"
            query={projectQuery}
            resetKey={`${location.repo}:${observation.data?.configured ? "workspace" : "observation"}`}
          >
            {content}
          </QueryContent>
        ) : (
          content
        )}
      </Suspense>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingHref(null);
            pendingNavigation.current = null;
          }
        }}
        open={pendingHref !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave configuration?</DialogTitle>
            <DialogDescription>
              Your changes have not been applied. The draft is saved on this
              browser so you can return to it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingHref(null)} variant="outline">
              Keep editing
            </Button>
            <Button
              onClick={() => {
                if (pendingHref) {
                  dirty.current = false;
                  const pending = pendingNavigation.current;
                  pendingNavigation.current = null;
                  setPendingHref(null);
                  if (pending?.traversal) {
                    historyAction.current = {
                      index: pending.traversal.targetIndex,
                      kind: "accept",
                    };
                    window.history.go(pending.traversal.delta);
                  } else if (pending?.fallback) {
                    window.location.assign(pending.href);
                  } else {
                    go(pendingHref);
                  }
                }
              }}
            >
              Leave and keep draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
};
