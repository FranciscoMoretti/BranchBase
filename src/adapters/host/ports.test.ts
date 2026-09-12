import { describe, expect, test } from "bun:test";

import { pathInside } from "./ports";

describe("worktree process ownership", () => {
  test("accepts a configured command working directory inside its worktree", () => {
    expect(pathInside("/code/repository/apps/web", "/code/repository")).toBe(
      true
    );
    expect(pathInside("/code/another-repository", "/code/repository")).toBe(
      false
    );
  });
});
