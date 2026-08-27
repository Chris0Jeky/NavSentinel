import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { waitForNavSentinelBridge } from "./e2e/extension_test_utils";

describe("waitForNavSentinelBridge", () => {
  it("reports readiness state and unpacked-extension recovery after a timeout", async () => {
    const page = {
      waitForFunction: vi.fn().mockRejectedValue(new Error("Timeout 25ms exceeded")),
      evaluate: vi.fn().mockResolvedValue({ capture: null, bridge: "1" })
    } as unknown as Page;

    await expect(waitForNavSentinelBridge(page, 25)).rejects.toThrow(
      "NavSentinel did not initialize on this page (capture=missing, bridge=1). " +
        "If this is an unpacked build from extension/dist, reload NavSentinel at " +
        "chrome://extensions before reloading the page; a page reload alone can retain a " +
        "stale hashed loader. " +
        "Original error: Timeout 25ms exceeded"
    );
  });
});
