import { describe, expect, it, spyOn } from "bun:test";

import { processIsLive, processStartMarker } from "./process-inspection";

describe("process inspection", () => {
  it("returns a stable non-empty identity for the current process", () => {
    const marker = processStartMarker(process.pid);
    expect(marker.length).toBeGreaterThan(0);
    expect(processStartMarker(process.pid)).toBe(marker);
  });

  it("treats a permission error as evidence that a process exists", () => {
    const kill = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("Operation not permitted"), {
        code: "EPERM",
      });
    });
    try {
      expect(processIsLive(123)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  it("treats a missing-process error as not live", () => {
    const kill = spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    try {
      expect(processIsLive(123)).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });
});
