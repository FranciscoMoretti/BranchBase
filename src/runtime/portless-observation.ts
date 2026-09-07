export type PortlessRouteObservation =
  | "routed"
  | "unavailable"
  | "unregistered";

export const PORTLESS_PROXY_PROBE_HOSTNAME = "branchbase-probe.localhost";

/** True once Portless owns the hostname; backend health is readiness, not routing. */
export const isPortlessRoutePublished = (
  observation: PortlessRouteObservation
): boolean => observation === "routed" || observation === "unavailable";

export const observePortlessRoute = async (
  url: string
): Promise<PortlessRouteObservation> => {
  try {
    const hostname = new URL(url).hostname;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(500),
    });
    const body = await response.text();
    if (
      response.status === 404 &&
      body.includes(`No app registered for <strong>${hostname}</strong>`)
    ) {
      return "unregistered";
    }
    return response.status === 502 ? "unavailable" : "routed";
  } catch {
    return "unavailable";
  }
};

export const isPortlessProxyResponding = async (
  probeUrl: string
): Promise<boolean> => (await observePortlessRoute(probeUrl)) !== "unavailable";

/**
 * Publication requires either a routed response, or an unavailable target whose
 * proxy still answers an independent probe (backend flap, not dead proxy).
 */
export const isPublishedPortlessRoute = async (
  routeUrl: string,
  proxyProbeUrl: string
): Promise<boolean> => {
  const observation = await observePortlessRoute(routeUrl);
  if (observation === "routed") {
    return true;
  }
  if (observation === "unregistered") {
    return false;
  }
  return isPortlessProxyResponding(proxyProbeUrl);
};
