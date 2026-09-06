import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import {
  hrefFor,
  type ProductLocation,
  readLocation,
  useObservation,
  useProjects,
} from "./data";
import { ObservedProjectPage } from "./observed-project-page";
import { Blank, Shell } from "./primitives";
import { ProjectsPage } from "./projects-page";
import { BranchBaseSettings } from "./settings-page";

const WorkspacePage = lazy(() =>
  import("./workspace-page").then((module) => ({
    default: module.WorkspacePage,
  }))
);

export function ProductApp() {
  const [location, setLocation] = useState(readLocation);
  const observation = useObservation(location.repo);
  const workspace = useWorkspace(
    location.repo,
    observation.data?.configured === true
  );
  const projects = useProjects();
  const client = useQueryClient();
  const dirty = useRef(false);
  const currentHref = useRef(window.location.href);
  const scrollPositions = useRef(new Map<string, number>());
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const go = useCallback((href: string) => {
    scrollPositions.current.set(currentHref.current, window.scrollY);
    window.history.pushState(null, "", href);
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
      if (event instanceof CustomEvent) {
        dirty.current = event.detail === true;
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
      if (dirty.current) {
        const target = window.location.href;
        window.history.replaceState(null, "", currentHref.current);
        setPendingHref(target);
      } else {
        currentHref.current = window.location.href;
        setLocation(readLocation());
      }
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
    Promise.all(
      paths.map((repoPath) => runCommand("save-project", { repoPath }))
    )
      .then(() => {
        localStorage.setItem("branchbase:projects-migrated", "1");
        return client.invalidateQueries({ queryKey: ["projects"] });
      })
      .catch(() => undefined);
  }, [client]);
  const inspectedPath = observation.data?.repoPath;
  useEffect(() => {
    if (location.repo && !inspectedPath) {
      return;
    }
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        top: scrollPositions.current.get(window.location.href) ?? 0,
        behavior: "instant",
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
    runCommand("save-project", { repoPath: inspectedPath })
      .then(() => client.invalidateQueries({ queryKey: ["projects"] }))
      .catch(() => undefined);
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
                  go(pendingHref);
                  setPendingHref(null);
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
}
