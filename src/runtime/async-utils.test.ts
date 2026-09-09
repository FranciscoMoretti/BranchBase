import { expect, test } from "bun:test";

import { pollUntil } from "./async-utils";

test("pollUntil propagates a condition failure without retrying", async () => {
  const failure = new Error("probe failed");
  let attempts = 0;

  await expect(
    pollUntil(
      () => {
        attempts += 1;
        throw failure;
      },
      { intervalMs: 1, message: "timed out", timeoutMs: 100 }
    )
  ).rejects.toBe(failure);
  expect(attempts).toBe(1);
});

test("pollUntil waits for each attempt before starting the next", async () => {
  let active = 0;
  let maximumActive = 0;
  let attempts = 0;

  await pollUntil(
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      attempts += 1;
      return attempts === 3;
    },
    { intervalMs: 0, message: "timed out", timeoutMs: 100 }
  );

  expect(attempts).toBe(3);
  expect(maximumActive).toBe(1);
});

test("pollUntil rejects with its timeout message when the condition stays false", async () => {
  let attempts = 0;

  await expect(
    pollUntil(
      () => {
        attempts += 1;
        return false;
      },
      { intervalMs: 1, message: "probe timed out", timeoutMs: 10 }
    )
  ).rejects.toThrow("probe timed out");
  expect(attempts).toBeGreaterThanOrEqual(1);
});

test("pollUntil honors a bounded attempt count", async () => {
  let attempts = 0;

  await expect(
    pollUntil(
      () => {
        attempts += 1;
        return false;
      },
      { intervalMs: 0, maxAttempts: 3, message: "attempts exhausted" }
    )
  ).rejects.toThrow("attempts exhausted");
  expect(attempts).toBe(3);
});
