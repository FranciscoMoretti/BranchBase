import { z } from "zod";

import { BranchBaseConfigSchema } from "./branchbase-schema";

const SCHEMA_ID =
  "https://raw.githubusercontent.com/FranciscoMoretti/BranchBase/main/schema/branchbase.schema.json";

export const branchbaseJsonSchema = (): Record<string, unknown> => ({
  ...z.toJSONSchema(BranchBaseConfigSchema, { io: "input" }),
  $id: SCHEMA_ID,
  description:
    "Configure repository commands, dynamic App endpoints, readiness, and exposed App-group environments.",
  title: "BranchBase configuration",
});
