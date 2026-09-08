import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import pathModule from "node:path";

const CLIENT_ROOT = pathModule.join(import.meta.dir);
const FORBIDDEN_PRIMITIVES =
  /<(?<tag>button|details|dialog|input|select|summary|textarea)\b/u;
const FORBIDDEN_PRIMITIVE_IMPORTS =
  /from ["'](?:@radix-ui\/|react-resizable-panels)/u;

const componentFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = pathModule.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "ui" ? [] : componentFiles(path);
    }
    return entry.name.endsWith(".tsx") ? [path] : [];
  });

describe("client primitive boundary", () => {
  it("routes native interactive elements through components/ui", () => {
    const violations = componentFiles(CLIENT_ROOT)
      .filter((file) => {
        const source = readFileSync(file, "utf-8");
        return (
          FORBIDDEN_PRIMITIVES.test(source) ||
          FORBIDDEN_PRIMITIVE_IMPORTS.test(source)
        );
      })
      .map((file) => pathModule.relative(CLIENT_ROOT, file));
    expect(violations).toEqual([]);
  });
});
