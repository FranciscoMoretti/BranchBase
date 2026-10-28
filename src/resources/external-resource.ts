import type { RunEndpoint } from "../app-group/assignments";
import { appIsReady, waitForAppReadiness } from "../app-group/readiness";
import type { BranchBaseAppGroup } from "../configuration/branchbase-schema";
import type { AppGroupSnapshot } from "../project/worktree-status-contract";
import type { ExistingResource } from "./resource-contract";

export const externalEndpoints = (
  group: BranchBaseAppGroup,
  resource: ExistingResource
): Record<string, RunEndpoint> =>
  Object.fromEntries(
    Object.entries(group.apps).map(([appId, app]) => {
      const endpoint = resource.apps[appId];
      if (!endpoint || endpoint.protocol !== app.protocol) {
        throw new Error(
          `Resource "${resource.name}" needs a matching ${app.protocol} endpoint named "${appId}".`
        );
      }
      const host = endpoint.host.includes(":")
        ? `[${endpoint.host}]`
        : endpoint.host;
      const url = `http://${host}:${endpoint.port}`;
      return [
        appId,
        {
          ...endpoint,
          appId,
          ...(app.protocol === "http" ? { directUrl: url, url } : {}),
        },
      ];
    })
  );

export const waitForExternalResource = async (
  group: BranchBaseAppGroup,
  resource: ExistingResource
): Promise<void> => {
  const endpoints = externalEndpoints(group, resource);
  await Promise.all(
    Object.entries(group.apps).map(([appId, app]) =>
      waitForAppReadiness(app, endpoints[appId])
    )
  );
};

interface Observation {
  at: number;
  ready: Record<string, boolean>;
  pending: boolean;
}

const refresh = async (
  observed: Observation,
  group: BranchBaseAppGroup,
  endpoints: Record<string, RunEndpoint>
): Promise<void> => {
  observed.pending = true;
  try {
    const entries = await Promise.all(
      Object.entries(group.apps).map(
        async ([appId, app]) =>
          [appId, await appIsReady(app, endpoints[appId])] as const
      )
    );
    observed.ready = Object.fromEntries(entries);
  } catch {
    observed.ready = {};
  } finally {
    observed.pending = false;
    observed.at = Date.now();
  }
};

export const unresolvedExternalResource = (
  groupId: string,
  group: BranchBaseAppGroup,
  resourceId: string
): AppGroupSnapshot => ({
  apps: Object.entries(group.apps).map(([id, app]) => ({
    directUrl: null,
    id,
    label: app.name ?? id,
    listening: false,
    open: false,
    ownership: "none",
    port: null,
    protocol: app.protocol,
    readiness: "unready",
    routeState: "inactive",
    url: null,
  })),
  category: "infrastructure",
  external: true,
  health: "not-running",
  id: groupId,
  instance: {
    id: `external:${resourceId}`,
    mode: "selectable",
    name: resourceId,
  },
  instances: [],
  name: group.name ?? groupId,
  processRunning: false,
  stop: "command",
});

/** Bounded, non-blocking observations of resources whose lifecycle we do not own. */
export class ExternalResourceObservation {
  private readonly results = new Map<string, Observation>();
  inspect(
    groupId: string,
    group: BranchBaseAppGroup,
    resource: ExistingResource
  ): AppGroupSnapshot {
    const endpoints = externalEndpoints(group, resource);
    const key = JSON.stringify([resource, group.apps]);
    let result = this.results.get(key);
    if (!result) {
      if (this.results.size >= 128) {
        const oldest = this.results.keys().next().value;
        if (oldest) {
          this.results.delete(oldest);
        }
      }
      result = { at: 0, pending: false, ready: {} };
      this.results.set(key, result);
    }
    const observed = result;
    if (!observed.pending && Date.now() - observed.at > 4000) {
      refresh(observed, group, endpoints);
    }
    const apps = Object.entries(group.apps).map(([id, app]) => {
      const readiness = observed.ready[id] ? "ready" : "unready";
      return {
        directUrl: endpoints[id].directUrl ?? null,
        host: endpoints[id].host,
        id,
        label: app.name ?? id,
        listening: observed.ready[id] ?? false,
        open: Boolean(observed.ready[id] && endpoints[id].url),
        ownership: "none" as const,
        port: endpoints[id].port,
        protocol: app.protocol,
        readiness: observed.at === 0 ? ("waiting" as const) : readiness,
        routeState: "inactive" as const,
        url: observed.ready[id] ? (endpoints[id].url ?? null) : null,
      } satisfies AppGroupSnapshot["apps"][number];
    });
    let health: AppGroupSnapshot["health"] = "not-running";
    if (apps.some((app) => app.listening)) {
      health = "partially-running";
    }
    if (apps.length && apps.every((app) => app.listening)) {
      health = "running";
    }
    return {
      ...unresolvedExternalResource(groupId, group, resource.id),
      apps,
      health,
      instance: {
        id: `external:${resource.id}`,
        mode: "selectable",
        name: resource.name,
      },
    };
  }
}
