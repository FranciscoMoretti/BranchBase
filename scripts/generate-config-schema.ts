import { writeFileSync } from "node:fs";
import pathModule from "node:path";

import { branchbaseJsonSchema } from "../src/configuration/branchbase-json-schema";

const path = pathModule.join(
  import.meta.dirname,
  "..",
  "schema",
  "branchbase.schema.json"
);
writeFileSync(path, `${JSON.stringify(branchbaseJsonSchema(), null, 2)}\n`);
