import { hrefFor, readLocation } from "./data";
import type { ProductLocation } from "./data";

const KEY = "branchbase:last-location:v1";
export const initialLocation = (): ProductLocation => {
  if (!window.location.search && !window.location.href.endsWith("?")) {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved) {
        const url = new URL(saved, window.location.origin);
        if (
          url.origin === window.location.origin &&
          url.pathname === "/" &&
          url.searchParams.has("repo")
        ) {
          window.history.replaceState(
            window.history.state,
            "",
            `${url.pathname}${url.search}`
          );
        }
      }
    } catch {
      /* A blocked browser store must not block navigation. */
    }
  }
  return readLocation();
};
export const rememberLocation = (location: ProductLocation) => {
  if (
    !location.repo ||
    location.view === "running" ||
    location.view === "machine"
  ) {
    return;
  }
  try {
    window.localStorage.setItem(KEY, hrefFor(location));
  } catch {
    /* Keep navigating without persistence. */
  }
};
