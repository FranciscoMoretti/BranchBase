import { expect, test } from "bun:test";

import { collectHostObservation } from "./host-observation";
import type { HostObservationAdapter } from "./host-observation";

test("collects listeners, cwds, process resources, and start identity with one bounded probe set", () => {
  const calls: string[] = [];
  const adapter: HostObservationAdapter = {
    run(program, args) {
      calls.push(`${program} ${args.join(" ")}`);
      if (program === "lsof" && args.includes("cwd")) {
        return { status: 0, stdout: "p42\nn/repo/worktree\n" };
      }
      if (program === "lsof") {
        return { status: 0, stdout: "p42\ncnode\nn*:3000\n" };
      }
      return {
        status: 0,
        stdout: "42 1 100 2.5 Mon Sep 01 12:34:56 2026\n",
      };
    },
  };

  const observation = collectHostObservation(adapter);
  expect(observation.listeners).toEqual([
    { address: "*:3000", command: "node", pid: 42, port: 3000 },
  ]);
  expect(observation.cwds.get(42)).toBe("/repo/worktree");
  expect(observation.samples?.[0]).toEqual({
    cpuPercent: 2.5,
    memoryBytes: 102_400,
    parentPid: 1,
    pid: 42,
  });
  expect(observation.startedAt.get(42)).toBe("2026-09-01T12:34:56.000Z");
  expect(calls.filter((call) => call.startsWith("ps "))).toHaveLength(1);
  expect(observation.available).toBe(true);
});

test("distinguishes an unavailable listener query from an empty listener set", () => {
  const unavailable = collectHostObservation({
    run: () => ({
      error: new Error("permission denied"),
      status: null,
      stdout: "",
    }),
  });
  expect(unavailable.available).toBe(false);
  expect(unavailable.listeners).toEqual([]);

  const empty = collectHostObservation({
    run: (_program, args) =>
      args.includes("-Fpcn")
        ? { status: 0, stdout: "" }
        : { status: 0, stdout: "" },
  });
  expect(empty.available).toBe(true);
  expect(empty.listeners).toEqual([]);
});
