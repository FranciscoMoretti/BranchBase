import { expect, test } from "bun:test";

import { hrefFor, parseLocation, routeForLocation } from "./location";
import type { ProductRoute } from "./location";

test("legacy links, encoded identifiers and supported tabs roundtrip", () => {
  const links = [
    "?page=workspace&repo=%2Ftmp%2Fa%26b&worktree=feature%2Fx&group=web&panel=tasks",
    "?repo=/project&view=settings&section=command%20trust",
    "?repo=/project&view=logs",
    "?view=activity",
    "?view=running",
    "?view=machine",
    "?",
  ];
  for (const search of links) {
    const location = parseLocation(search);
    expect(parseLocation(hrefFor(routeForLocation(location)).slice(1))).toEqual(
      location
    );
  }
  expect(parseLocation(links[0])).toMatchObject({
    panel: "tasks",
    repo: "/tmp/a&b",
    worktree: "feature/x",
  });
  expect(parseLocation("?page=logs&repo=/project").view).toBe("logs");
  expect(parseLocation("?view=activity&page=logs&repo=/project").view).toBe(
    "activity"
  );
});

test("malformed and incompatible URL state is normalized at the boundary", () => {
  expect(
    parseLocation("?repo=/project&worktree=main&panel=bogus&section=bogus")
  ).toMatchObject({ panel: "logs", section: "general" });
  expect(parseLocation("?view=settings&group=web&worktree=main")).toMatchObject(
    { group: "", repo: "", view: "workspace", worktree: "" }
  );
  expect(parseLocation("?repo=/project&group=web").group).toBe("");
  for (const view of ["running", "machine"]) {
    expect(
      parseLocation(`?view=${view}&repo=/project&worktree=main&group=web`)
    ).toMatchObject({ group: "", repo: "", view, worktree: "" });
  }
  expect(parseLocation("?repo=/project&view=unknown").view).toBe("workspace");
  expect(() =>
    parseLocation("?repo=%E0%A4%A&panel=%&view=__proto__")
  ).not.toThrow();
});

// Compile-time regression checks: these invalid destinations must remain rejected.
const invalidRoutes = () => {
  // @ts-expect-error Repository pages require a repository.
  hrefFor({ view: "settings" });
  // @ts-expect-error Global pages cannot carry a repository.
  hrefFor({ repo: "/project", view: "running" });
  // @ts-expect-error A group requires its worktree.
  hrefFor({ group: "web", repo: "/project" });
  // @ts-expect-error Selections belong to workspace routes.
  hrefFor({ repo: "/project", view: "activity", worktree: "main" });
  // @ts-expect-error Panel names are a closed vocabulary.
  hrefFor({ panel: "unknown", repo: "/project", worktree: "main" });
  // @ts-expect-error Settings sections are a closed vocabulary.
  hrefFor({ repo: "/project", section: "unknown", view: "settings" });
};
void invalidRoutes;
const validRoutes: ProductRoute[] = [
  {},
  { view: "machine" },
  { repo: "/project" },
  { group: "web", panel: "configuration", repo: "/project", worktree: "main" },
];
test("typed routes preserve the explicit All repositories URL", () => {
  expect(validRoutes.map(hrefFor)[0]).toBe("/?");
});
