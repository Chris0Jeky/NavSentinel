import { describe, expect, it } from "vitest";

import {
  E2E_WORKERS_ENV,
  resolveE2eTopology,
} from "./e2e/playwright-topology";

describe("resolveE2eTopology", () => {
  it("defaults local runs to a single serial worker", () => {
    expect(resolveE2eTopology({})).toEqual({ fullyParallel: false, workers: 1 });
  });

  it("keeps the CI topology serial regardless of the local override", () => {
    expect(resolveE2eTopology({ CI: "true" })).toEqual({
      fullyParallel: false,
      workers: 1,
    });
    expect(
      resolveE2eTopology({ CI: "true", [E2E_WORKERS_ENV]: "4" }),
    ).toEqual({ fullyParallel: false, workers: 1 });
  });

  it("treats CI exactly as the previous inline `process.env.CI ? ... : ...` did", () => {
    // "0" is a truthy string in JS, and an empty CI value was previously local.
    expect(resolveE2eTopology({ CI: "0" }).workers).toBe(1);
    expect(resolveE2eTopology({ CI: "" })).toEqual({
      fullyParallel: false,
      workers: 1,
    });
    expect(
      resolveE2eTopology({ CI: "", [E2E_WORKERS_ENV]: "4" }),
    ).toEqual({ fullyParallel: true, workers: 4 });
  });

  it("opts into parallel local runs when the override asks for more than one worker", () => {
    expect(resolveE2eTopology({ [E2E_WORKERS_ENV]: "4" })).toEqual({
      fullyParallel: true,
      workers: 4,
    });
    expect(resolveE2eTopology({ [E2E_WORKERS_ENV]: " 2 " })).toEqual({
      fullyParallel: true,
      workers: 2,
    });
  });

  it("stays serial when the override explicitly asks for one worker", () => {
    expect(resolveE2eTopology({ [E2E_WORKERS_ENV]: "1" })).toEqual({
      fullyParallel: false,
      workers: 1,
    });
  });

  it("ignores an empty override instead of failing", () => {
    expect(resolveE2eTopology({ [E2E_WORKERS_ENV]: "   " })).toEqual({
      fullyParallel: false,
      workers: 1,
    });
  });

  it("rejects a malformed override instead of guessing a topology", () => {
    for (const value of ["four", "0", "-1", "2.5", "1e1x"]) {
      expect(() => resolveE2eTopology({ [E2E_WORKERS_ENV]: value })).toThrow(
        E2E_WORKERS_ENV,
      );
    }
  });
});
