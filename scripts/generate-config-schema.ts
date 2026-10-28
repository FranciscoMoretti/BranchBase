import { writeFileSync } from "node:fs";
import pathModule from "node:path";

import { z } from "zod";

import { branchbaseJsonSchema } from "../src/configuration/branchbase-json-schema";
import { ManagedResourceDefinitionSchema } from "../src/configuration/managed-resource-schema";

const path = pathModule.join(
  import.meta.dirname,
  "..",
  "schema",
  "branchbase.schema.json"
);
writeFileSync(path, `${JSON.stringify(branchbaseJsonSchema(), null, 2)}\n`);

writeFileSync(
  pathModule.join(
    import.meta.dirname,
    "..",
    "schema",
    "managed-resource.schema.json"
  ),
  `${JSON.stringify(z.toJSONSchema(ManagedResourceDefinitionSchema, { io: "input", target: "draft-7" }), null, 2)}\n`
);
