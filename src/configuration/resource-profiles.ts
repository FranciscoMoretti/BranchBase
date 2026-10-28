import { z } from "zod";

import type { BranchBaseConfig } from "./branchbase-schema";

export const ResourceConnectionSchema = z.discriminatedUnion("policy", [
  z.strictObject({
    instance: z.string().min(1),
    policy: z.literal("managed"),
    resource: z.string().min(1),
  }),
  z.strictObject({
    idle: z.enum(["keep-running", "stop-when-unused"]).optional(),
    policy: z.literal("project"),
  }),
  z.strictObject({
    idle: z.enum(["keep-running", "stop-when-unused"]).optional(),
    policy: z.literal("worktree"),
  }),
  z.strictObject({
    policy: z.literal("existing"),
    resource: z.string().min(1),
  }),
]);
export type ResourceConnection = z.infer<typeof ResourceConnectionSchema>;
export const ResourceProfilesSchema = z.strictObject({
  default: z.string().min(1),
  definitions: z.record(
    z.string().min(1),
    z.strictObject({
      connections: z.record(z.string().min(1), ResourceConnectionSchema),
      name: z.string().min(1),
    })
  ),
  rules: z
    .array(
      z.strictObject({ branch: z.string().min(1), profile: z.string().min(1) })
    )
    .optional(),
});
export type ResourceProfiles = z.infer<typeof ResourceProfilesSchema>;
export interface ResolvedProfile {
  id: string;
  name: string;
  source: "override" | "branch" | "default";
  connections: Record<string, ResourceConnection>;
}

// Deliberately small glob language: '*' matches any branch-name characters.
export const branchMatches = (pattern: string, branch: string): boolean => {
  if (!pattern.includes("*")) {
    return pattern === branch;
  }
  const parts = pattern.split("*");
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    const found = branch.indexOf(part, offset);
    if (found === -1 || (index === 0 && found !== 0)) {
      return false;
    }
    offset = found + part.length;
  }
  return pattern.endsWith("*") || branch.endsWith(parts.at(-1) ?? "");
};

export const resolveResourceProfile = (
  config: BranchBaseConfig,
  branch: string,
  override?: string | null
): ResolvedProfile | null => {
  if (!config.profiles) {
    return null;
  }
  const { profiles } = config;
  const rule = profiles.rules?.find((item) =>
    branchMatches(item.branch, branch)
  );
  const id = override ?? rule?.profile ?? profiles.default;
  const definition = profiles.definitions[id];
  if (!definition) {
    throw new Error(
      `Unknown resource profile "${id}". Choose a configured profile.`
    );
  }
  const connections = Object.fromEntries(
    Object.entries(config.appGroups)
      .filter(([, group]) => group.category === "infrastructure")
      .map(([groupId]) => [
        groupId,
        definition.connections[groupId] ?? { policy: "project" as const },
      ])
  );
  let source: ResolvedProfile["source"] = "default";
  if (rule) {
    source = "branch";
  }
  if (override) {
    source = "override";
  }
  return {
    connections,
    id,
    name: definition.name,
    source,
  };
};

export const defaultResourceProfiles = (
  config: BranchBaseConfig
): ResourceProfiles => ({
  default: "shared",
  definitions: {
    isolated: {
      connections: Object.fromEntries(
        Object.entries(config.appGroups)
          .filter(([, group]) => group.category === "infrastructure")
          .map(([id]) => [id, { idle: "stop-when-unused", policy: "worktree" }])
      ),
      name: "Isolated development",
    },
    shared: { connections: {}, name: "Shared development" },
  },
});

export const dependencyOrder = (
  config: BranchBaseConfig,
  groupId: string
): string[] => {
  const active = new Set<string>();
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (id: string) => {
    if (active.has(id)) {
      throw new Error(`App-group dependency cycle at "${id}"`);
    }
    if (visited.has(id)) {
      return;
    }
    const group = config.appGroups[id];
    if (!group) {
      throw new Error(`Unknown dependency "${id}"`);
    }
    active.add(id);
    const dependencies =
      group.dependsOn ??
      (config.profiles && group.category !== "infrastructure"
        ? Object.keys(config.appGroups).filter(
            (key) => config.appGroups[key].category === "infrastructure"
          )
        : []);
    for (const dependency of dependencies) {
      visit(dependency);
    }
    active.delete(id);
    visited.add(id);
    result.push(id);
  };
  visit(groupId);
  return result;
};
