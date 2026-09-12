import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

const sourceRoot = path.resolve(import.meta.dir, "..");
const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(file);
    }
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [file]
      : [];
  });

const imports = (file: string): string[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true
  );
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
};

const relativeImports = (file: string): string[] =>
  imports(file)
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => {
      const base = path.resolve(path.dirname(file), specifier);
      for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
      ]) {
        try {
          if (statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          // Try the next TypeScript resolution candidate.
        }
      }
      return null;
    })
    .filter((resolvedFile): resolvedFile is string => resolvedFile !== null);

describe("architecture boundaries", () => {
  test("domain and adapter modules do not depend on interaction adapters", () => {
    const roots = [
      "activity",
      "adapters/git",
      "adapters/host",
      "adapters/persistence",
      "adapters/routing",
      "app-group",
      "codex",
      "configuration",
      "project",
    ];
    const violations = roots.flatMap((root) =>
      sourceFiles(path.join(sourceRoot, root)).flatMap((file) =>
        imports(file)
          .filter((specifier) =>
            /(?:^|\/)(?:application|cli|http|client|daemon)(?:\/|$)/u.test(
              specifier
            )
          )
          .map(
            (specifier) => `${path.relative(sourceRoot, file)} -> ${specifier}`
          )
      )
    );

    expect(violations).toEqual([]);
  });

  test("application modules do not depend on client, daemon, CLI, or HTTP", () => {
    const violations = sourceFiles(
      path.join(sourceRoot, "application")
    ).flatMap((file) =>
      imports(file)
        .filter((specifier) =>
          /(?:^|\/)(?:client|daemon|cli|http)(?:\/|$)/u.test(specifier)
        )
        .map(
          (specifier) => `${path.relative(sourceRoot, file)} -> ${specifier}`
        )
    );

    expect(violations).toEqual([]);
  });

  test("client dependency graph contains no Node or Bun runtime imports", () => {
    const pending = sourceFiles(path.join(sourceRoot, "client"));
    const visited = new Set<string>();
    const violations: string[] = [];
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file || visited.has(file)) {
        continue;
      }
      visited.add(file);
      for (const specifier of imports(file)) {
        if (
          specifier.startsWith("node:") ||
          specifier === "bun" ||
          specifier.startsWith("bun:")
        ) {
          violations.push(`${path.relative(sourceRoot, file)} -> ${specifier}`);
        }
      }
      pending.push(...relativeImports(file));
    }

    expect(violations).toEqual([]);
  });
});
