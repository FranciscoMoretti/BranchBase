import { expect, test } from "bun:test";

import { activityPeriodStart } from "./activity-page";

const DAY = 86_400_000;

test("a delayed period selection excludes events outside the selected window", () => {
  const selectedAt = 10 * DAY;
  const refreshedAt = selectedAt - 5000;
  const eventAt = selectedAt - DAY - 1000;
  expect(eventAt < activityPeriodStart("day", selectedAt, refreshedAt)).toBe(
    true
  );
});

test("refreshed activity advances an existing weekly window", () => {
  const selectedAt = 10 * DAY;
  const refreshedAt = selectedAt + DAY;
  const eventAt = selectedAt - 7 * DAY + 1000;
  expect(eventAt < activityPeriodStart("week", selectedAt, refreshedAt)).toBe(
    true
  );
});

test("all activity remains visible regardless of selection and refresh time", () => {
  expect(activityPeriodStart("all", 10 * DAY, 11 * DAY)).toBe(0);
});
