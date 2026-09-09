import { setTimeout } from "node:timers/promises";

export const delay = async (milliseconds: number): Promise<void> => {
  await setTimeout(milliseconds);
};

type PollUntilOptions = {
  intervalMs: number;
  message: string;
  timeoutError?: Error;
} & (
  | { maxAttempts: number; timeoutMs?: number }
  | { maxAttempts?: number; timeoutMs: number }
);

export const pollUntil = async (
  condition: () => boolean | Promise<boolean>,
  options: PollUntilOptions
): Promise<void> => {
  const deadline =
    options.timeoutMs === undefined
      ? Number.POSITIVE_INFINITY
      : Date.now() + options.timeoutMs;
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
  let attempts = 0;
  while (attempts < maxAttempts && Date.now() < deadline) {
    attempts += 1;
    // oxlint-disable-next-line no-await-in-loop -- Polling must observe each attempt before scheduling the next one.
    if (await condition()) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling waits between ordered observations.
    await delay(options.intervalMs);
  }
  throw options.timeoutError ?? new Error(options.message);
};
