import { z } from "zod";

export const WorktreeConfigSourceSchema = z.enum([
  "project-default",
  "checkout",
]);

export type WorktreeConfigSource = z.infer<typeof WorktreeConfigSourceSchema>;
