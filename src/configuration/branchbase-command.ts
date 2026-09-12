import { z } from "zod";

export const BranchBaseCommandSchema = z.strictObject({
  argv: z.array(z.string().min(1)).min(1),
  cwd: z.string().min(1).optional(),
});

export type BranchBaseCommand = z.infer<typeof BranchBaseCommandSchema>;

export const defaultBranchBaseSetupCommand = (): BranchBaseCommand => ({
  argv: ["bun", "install"],
});

export const defaultBranchBaseStartCommand = (): BranchBaseCommand => ({
  argv: ["bun", "run", "dev"],
});
