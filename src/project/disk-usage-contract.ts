import { z } from "zod";

export const DiskUsageSchema = z.object({
  bytes: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
  measuredAt: z.string().nullable(),
  state: z.enum(["pending", "ready", "unavailable"]),
});

export type DiskUsage = z.infer<typeof DiskUsageSchema>;
