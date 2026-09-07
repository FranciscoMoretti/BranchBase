import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

import migration from "./lint-migration.json" with { type: "json" };

export default defineConfig({
  extends: [core, react],
  ignorePatterns: core.ignorePatterns,
  // Temporary migration overrides are removed as each rule is addressed.
  rules: migration.rules as Record<string, "off">,
});
