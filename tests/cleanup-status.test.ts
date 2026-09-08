import { expect, it } from "vitest";
import { cleanupStatus, renderCleanupStatus } from "../extension/src/shared/cleanup_status";

it("distinguishes disabled cleanup from paused and active cleanup", () => {
  expect(cleanupStatus({ defaultMode: "off", debug: false, autoDismissOverlays: false })).toEqual({ text: "Disabled", state: "disabled" });
  expect(cleanupStatus({ defaultMode: "off", debug: false, autoDismissOverlays: true })).toEqual({ text: "Paused · Navigation Off", state: "paused" });
  for (const defaultMode of ["smart", "strict"] as const) {
    expect(cleanupStatus({ defaultMode, debug: false, autoDismissOverlays: true })).toEqual({ text: "Active", state: "active" });
  }
});

it("renders the cleanup text and state onto a shared status element", () => {
  const element = { textContent: "", dataset: {} } as unknown as HTMLElement;
  renderCleanupStatus(element, { defaultMode: "off", debug: false, autoDismissOverlays: true });
  expect(element.textContent).toBe("Paused · Navigation Off");
  expect(element.dataset.state).toBe("paused");
});
