import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { waitForNavSentinelBridge } from "./e2e/extension_test_utils";

describe("waitForNavSentinelBridge", () => {
  it("reports readiness state and unpacked-extension recovery after a timeout", async () => {
    const page = {
      waitForFunction: vi.fn().mockRejectedValue(new Error("Timeout 25ms exceeded")),
      evaluate: vi.fn().mockResolvedValue({ capture: null, bridge: "1", guard: null })
    } as unknown as Page;
    const expectedGuard = "fixture-guard";

    await expect(waitForNavSentinelBridge(page, 25, expectedGuard)).rejects.toThrow(
      `NavSentinel did not initialize on this page (capture=missing, bridge=1, ` +
        `guard=missing; expected guard=${expectedGuard}). ` +
        "If this is an unpacked build from extension/dist, its owner must reload " +
        "NavSentinel at chrome://extensions before reloading the page; browser automation " +
        "cannot prove that Chrome accepted the new artifact. " +
        "Original error: Timeout 25ms exceeded"
    );
  });
});
