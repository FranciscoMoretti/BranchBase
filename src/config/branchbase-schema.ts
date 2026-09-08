import { z } from "zod";

import { BranchBaseCommandSchema } from "./branchbase-command";
import { branchbaseTemplateError } from "./branchbase-template";

export const MIN_BRANCHBASE_PORT = 1024;
export const MAX_BRANCHBASE_PORT = 65_535;

export const BranchBaseAppGroupNameSchema = z.string().min(1);
export const BranchBaseAppIdSchema = z.string().min(1);
export const BranchBaseEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

const HttpReadinessSchema = z.strictObject({
  path: z.string().startsWith("/").default("/"),
  statuses: z
    .string()
    .regex(/^\d{3}-\d{3}$/u)
    .refine((range) => {
      const [minimum, maximum] = range.split("-").map(Number);
      return (
        minimum !== undefined &&
        maximum !== undefined &&
        minimum >= 100 &&
        maximum <= 599 &&
        minimum <= maximum
      );
    }, "HTTP status range must be ordered between 100 and 599")
    .default("200-399"),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  type: z.literal("http"),
});

export const BranchBaseReadinessSchema = z.union([
  z.literal("tcp"),
  HttpReadinessSchema,
]);

export const BranchBaseAppSchema = z.strictObject({
  name: z.string().min(1).optional(),
  protocol: z.enum(["http", "tcp"]),
  readiness: BranchBaseReadinessSchema.default("tcp"),
});

export type BranchBaseApp = z.infer<typeof BranchBaseAppSchema>;

export const BranchBaseAppGroupStopSchema = z.union([
  z.literal("process"),
  BranchBaseCommandSchema,
]);

export const BranchBaseAppGroupInstancesSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("per-worktree") }),
  z.strictObject({ mode: z.literal("selectable") }),
]);

export const BranchBaseAppGroupSchema = z.strictObject({
  apps: z.record(BranchBaseAppIdSchema, BranchBaseAppSchema),
  category: z.enum(["application", "infrastructure"]).optional(),
  env: z.record(BranchBaseEnvironmentNameSchema, z.string()).optional(),
  instances: BranchBaseAppGroupInstancesSchema.default({
    mode: "per-worktree",
  }),
  name: z.string().min(1).optional(),
  start: BranchBaseCommandSchema,
  stop: BranchBaseAppGroupStopSchema,
});

export type BranchBaseAppGroup = z.infer<typeof BranchBaseAppGroupSchema>;

const BranchBaseConfigObjectSchema = z.strictObject({
  $schema: z.string().optional(),
  appGroups: z.record(BranchBaseAppGroupNameSchema, BranchBaseAppGroupSchema),
  setup: BranchBaseCommandSchema,
  version: z.literal(1),
});

type BranchBaseConfigShape = z.infer<typeof BranchBaseConfigObjectSchema>;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep schema issues colocated with their exact JSON paths.
const validateBranchBaseConfig = (
  config: BranchBaseConfigShape,
  context: z.RefinementCtx
): void => {
  const groups = Object.entries(config.appGroups);
  if (groups.length === 0) {
    context.addIssue({
      code: "custom",
      message: "BranchBase config requires at least one App group",
      path: ["appGroups"],
    });
    return;
  }

  for (const [groupId, group] of groups) {
    const apps = Object.entries(group.apps);
    if (apps.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An App group requires at least one App",
        path: ["appGroups", groupId, "apps"],
      });
      continue;
    }
    for (const [appId, app] of apps) {
      if (app.protocol === "tcp" && app.readiness !== "tcp") {
        context.addIssue({
          code: "custom",
          message: "TCP Apps support TCP readiness only",
          path: ["appGroups", groupId, "apps", appId, "readiness"],
        });
      }
    }
    for (const [name, template] of Object.entries(group.env ?? {})) {
      const error = branchbaseTemplateError(
        template,
        config.appGroups,
        groupId
      );
      if (error) {
        context.addIssue({
          code: "custom",
          message: error,
          path: ["appGroups", groupId, "env", name],
        });
      }
    }
    for (const [index, argument] of group.start.argv.entries()) {
      const error = branchbaseTemplateError(
        argument,
        config.appGroups,
        groupId
      );
      if (error) {
        context.addIssue({
          code: "custom",
          message: error,
          path: ["appGroups", groupId, "start", "argv", index],
        });
      }
    }
    if (group.stop !== "process") {
      for (const [index, argument] of group.stop.argv.entries()) {
        const error = branchbaseTemplateError(
          argument,
          config.appGroups,
          groupId
        );
        if (error) {
          context.addIssue({
            code: "custom",
            message: error,
            path: ["appGroups", groupId, "stop", "argv", index],
          });
        }
      }
    }
  }
};

export const BranchBaseConfigSchema = BranchBaseConfigObjectSchema.superRefine(
  validateBranchBaseConfig
);

export type BranchBaseConfig = z.infer<typeof BranchBaseConfigSchema>;
export type WorktreeEnvConfig = BranchBaseConfig;

export const cloneBranchBaseConfig = (
  config: BranchBaseConfig
): BranchBaseConfig => structuredClone(config);
