import { z } from "zod";

import { BranchBaseConfigSchema } from "../config/branchbase-schema";
import { RepositoryTrustApprovalSchema } from "../config/repository-trust-approval";
import { WorktreeConfigSourceSchema } from "../config/worktree-config-source";
import { AppPinSchema } from "./product-contract";

const RepositoryPathSchema = z.object({
  repoPath: z.string().min(1),
});
const StartStopSchema = RepositoryPathSchema.extend({
  appGroupName: z.string().min(1),
  worktreeId: z.string().min(1),
});
const VisibleBulkSchema = RepositoryPathSchema.extend({
  appGroupName: z.string().min(1).optional(),
  worktreeIds: z.array(z.string().min(1)),
});

export const CommandReceiptSchema = z.object({
  appGroupName: z.string().optional(),
  command: z.string(),
  message: z.string(),
  ok: z.literal(true),
  worktreeId: z.string().optional(),
});
export const PickRepositoryResultSchema = z.object({
  path: z.string().min(1).nullable(),
});
export const RepositoryInitializationPlanSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  configPath: z.string(),
  detectedRuntime: z.string(),
  detectedSetupCommand: z.string().nullable(),
  detectedStartCommand: z.string().nullable(),
  repoPath: z.string(),
});

const INPUT_SCHEMAS = {
  "add-development-folder": RepositoryPathSchema,
  "clear-logs": StartStopSchema,
  "create-app-group-instance": StartStopSchema.extend({
    name: z.string().trim().min(1),
  }),
  "create-worktree": RepositoryPathSchema.extend({
    branch: z.string().min(1),
    createBranch: z.boolean(),
    folderName: z.string().min(1),
  }),
  "delete-worktree": StartStopSchema,
  "initialize-repository": RepositoryPathSchema,
  "pick-repository": z.object({}),
  "preview-repository-config": RepositoryPathSchema,
  "remove-development-folder": RepositoryPathSchema,
  "remove-project": RepositoryPathSchema,
  "restart-apps": StartStopSchema,
  "restart-running-apps": VisibleBulkSchema,
  "retry-apps": StartStopSchema,
  "revoke-trust": RepositoryPathSchema,
  "save-project": RepositoryPathSchema.extend({
    name: z.string().trim().min(1).max(100).optional(),
    pins: z.array(AppPinSchema).max(24).optional(),
  }),
  "scan-development-folders": z.object({}),
  "select-app-group-instance": StartStopSchema.extend({
    instanceId: z.string().min(1),
  }),
  "select-worktree-config-source": RepositoryPathSchema.extend({
    source: WorktreeConfigSourceSchema,
    worktreeId: z.string().min(1),
  }),
  "setup-all-apps": VisibleBulkSchema,
  "start-all-apps": VisibleBulkSchema,
  "start-apps": StartStopSchema,
  "stop-all-apps": VisibleBulkSchema,
  "stop-apps": StartStopSchema,
  "trust-repository": RepositoryPathSchema.extend({
    approvals: z.array(RepositoryTrustApprovalSchema).min(1),
  }),
  "update-repository-config": RepositoryPathSchema.extend({
    config: BranchBaseConfigSchema,
    revision: z.string().min(1),
  }),
} as const;

const RESULT_SCHEMAS = {
  "add-development-folder": CommandReceiptSchema,
  "clear-logs": CommandReceiptSchema,
  "create-app-group-instance": CommandReceiptSchema,
  "create-worktree": CommandReceiptSchema,
  "delete-worktree": CommandReceiptSchema,
  "initialize-repository": RepositoryInitializationPlanSchema,
  "pick-repository": PickRepositoryResultSchema,
  "preview-repository-config": RepositoryInitializationPlanSchema,
  "remove-development-folder": CommandReceiptSchema,
  "remove-project": CommandReceiptSchema,
  "restart-apps": CommandReceiptSchema,
  "restart-running-apps": CommandReceiptSchema,
  "retry-apps": CommandReceiptSchema,
  "revoke-trust": CommandReceiptSchema,
  "save-project": CommandReceiptSchema,
  "scan-development-folders": CommandReceiptSchema,
  "select-app-group-instance": CommandReceiptSchema,
  "select-worktree-config-source": CommandReceiptSchema,
  "setup-all-apps": CommandReceiptSchema,
  "start-all-apps": CommandReceiptSchema,
  "start-apps": CommandReceiptSchema,
  "stop-all-apps": CommandReceiptSchema,
  "stop-apps": CommandReceiptSchema,
  "trust-repository": CommandReceiptSchema,
  "update-repository-config": CommandReceiptSchema,
} as const;

export type BranchBaseCommandName = keyof typeof INPUT_SCHEMAS;
export type BranchBaseCommandInput<Name extends BranchBaseCommandName> =
  z.infer<(typeof INPUT_SCHEMAS)[Name]>;
export type BranchBaseCommandResult<Name extends BranchBaseCommandName> =
  z.infer<(typeof RESULT_SCHEMAS)[Name]>;

export function isBranchBaseCommandName(
  value: string
): value is BranchBaseCommandName {
  return value in INPUT_SCHEMAS;
}

export function parseCommandInput<Name extends BranchBaseCommandName>(
  name: Name,
  input: unknown
): BranchBaseCommandInput<Name> {
  return INPUT_SCHEMAS[name].parse(input) as BranchBaseCommandInput<Name>;
}

export function parseCommandResult<Name extends BranchBaseCommandName>(
  name: Name,
  result: unknown
): BranchBaseCommandResult<Name> {
  return RESULT_SCHEMAS[name].parse(result) as BranchBaseCommandResult<Name>;
}
