export type ProductPanel = "logs" | "activity" | "configuration" | "tasks";
export type ProductSection =
  | "general"
  | "configuration"
  | "command trust"
  | "integrations";
export type ProductView =
  | "workspace"
  | "worktrees"
  | "logs"
  | "infrastructure"
  | "activity"
  | "settings"
  | "running"
  | "machine";

/** Normalized URL state; empty identifiers mean no selection. */
export interface ProductLocation {
  group: string;
  panel: ProductPanel;
  repo: string;
  section: ProductSection;
  view: ProductView;
  worktree: string;
}

interface NoSelection {
  worktree?: never;
  group?: never;
  panel?: never;
}
/** Link destinations, distinct from the normalized state used by page rendering. */
export type ProductRoute =
  | (NoSelection & {
      repo?: never;
      view?: "workspace" | "activity" | "running" | "machine";
      section?: never;
    })
  | (NoSelection & {
      repo: string;
      view: "worktrees" | "logs" | "infrastructure" | "activity";
      section?: never;
    })
  | (NoSelection & {
      repo: string;
      view: "settings";
      section?: ProductSection;
    })
  | ({ repo: string; view?: "workspace"; section?: never } & (
      | NoSelection
      | { worktree: string; group?: string; panel?: ProductPanel }
    ));

export const isProductPanel = (value: unknown): value is ProductPanel =>
  value === "logs" ||
  value === "activity" ||
  value === "configuration" ||
  value === "tasks";
export const isProductSection = (value: unknown): value is ProductSection =>
  value === "general" ||
  value === "configuration" ||
  value === "command trust" ||
  value === "integrations";
const isProductView = (value: unknown): value is ProductView =>
  value === "workspace" ||
  value === "worktrees" ||
  value === "logs" ||
  value === "infrastructure" ||
  value === "activity" ||
  value === "settings" ||
  value === "running" ||
  value === "machine";

/** The only boundary at which untrusted URL values become product navigation state. */
export const parseLocation = (search: string): ProductLocation => {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view") ?? params.get("page");
  let view = isProductView(requestedView) ? requestedView : "workspace";
  const repo =
    view === "running" || view === "machine" ? "" : (params.get("repo") ?? "");
  if (
    !repo &&
    view !== "activity" &&
    view !== "running" &&
    view !== "machine"
  ) {
    view = "workspace";
  }
  const worktree =
    repo && view === "workspace" ? (params.get("worktree") ?? "") : "";
  const panel = params.get("panel");
  const section = params.get("section");
  return {
    group: worktree ? (params.get("group") ?? "") : "",
    panel: worktree && isProductPanel(panel) ? panel : "logs",
    repo,
    section:
      view === "settings" && isProductSection(section) ? section : "general",
    view,
    worktree,
  };
};
export const readLocation = (): ProductLocation =>
  parseLocation(window.location.search);

export const routeForLocation = (location: ProductLocation): ProductRoute => {
  const { repo, view, worktree, group, panel, section } = location;
  if (view === "running" || view === "machine") {
    return { view };
  }
  if (!repo) {
    return { view: view === "activity" ? "activity" : "workspace" };
  }
  if (view === "settings") {
    return { repo, section, view };
  }
  if (view === "workspace") {
    return worktree ? { group, panel, repo, view, worktree } : { repo, view };
  }
  return { repo, view };
};
export const hrefFor = (location: ProductRoute): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(location)) {
    if (value && !(key === "view" && value === "workspace")) {
      params.set(key, value);
    }
  }
  return `/?${params}`;
};
