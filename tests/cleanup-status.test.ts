import { expect, it } from "vitest";
import { cleanupStatus } from "../extension/src/shared/cleanup_status";

it("distinguishes disabled cleanup from paused and active cleanup", () => {
  expect(cleanupStatus({ defaultMode: "off", debug: false, autoDismissOverlays: false })).toEqual({ text: "Disabled", state: "disabled" });
  expect(cleanupStatus({ defaultMode: "off", debug: false, autoDismissOverlays: true })).toEqual({ text: "Paused · Navigation Off", state: "paused" });
  for (const defaultMode of ["smart", "strict"] as const) {
    expect(cleanupStatus({ defaultMode, debug: false, autoDismissOverlays: true })).toEqual({ text: "Active", state: "active" });
  }
});
