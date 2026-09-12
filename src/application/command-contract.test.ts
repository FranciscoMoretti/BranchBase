import { expect, test } from "bun:test";

import { parseCommandResult } from "./command-contract";

test("receipts distinguish accepted background work from completed operations", () => {
  expect(
    parseCommandResult("setup-all-apps", {
      command: "setup-all-apps",
      completion: "accepted",
      message: "Setup started",
      ok: true,
    }).completion
  ).toBe("accepted");
  expect(
    parseCommandResult("stop-apps", {
      command: "stop-apps",
      message: "Stopped",
      ok: true,
    }).completion
  ).toBe("completed");
});
