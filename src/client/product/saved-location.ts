import {
  hrefFor,
  parseLocation,
  readLocation,
  routeForLocation,
} from "./location";
import type { ProductLocation } from "./location";

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
          parseLocation(url.search).repo
        ) {
          window.history.replaceState(
            window.history.state,
            "",
            hrefFor(routeForLocation(parseLocation(url.search)))
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
    window.localStorage.setItem(KEY, hrefFor(routeForLocation(location)));
  } catch {
    /* Keep navigating without persistence. */
  }
};
