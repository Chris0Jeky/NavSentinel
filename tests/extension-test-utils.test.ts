// @vitest-environment happy-dom
import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { waitForNavSentinelBridge } from "./e2e/extension_test_utils";

describe("waitForNavSentinelBridge", () => {
  it("keeps waiting for delayed bridge readiness and the exact built guard", async () => {
    const root = document.documentElement;
    const expectedGuard = "fixture-guard";
    let checkReadiness = () => false;
    let releaseReadiness!: () => void;
    let completed = false;
    const onboarding = {
      url: () => "chrome-extension://fixture/onboarding.html",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      waitForFunction: (predicate: (guard: string) => boolean, guard: string) => {
        checkReadiness = () => predicate(guard);
        return new Promise<void>(resolve => { releaseReadiness = resolve; });
      },
      context: () => ({ pages: () => [onboarding] }),
    } as unknown as Page;
    const waiting = waitForNavSentinelBridge(page, 25, expectedGuard).then(() => { completed = true; });

    try {
      root.setAttribute("data-navsentinel-capture-ready", "1");
      root.setAttribute("data-navsentinel-ui-guard", expectedGuard);
      expect(checkReadiness()).toBe(false);
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(onboarding.close).not.toHaveBeenCalled();

      root.setAttribute("data-navsentinel-bridge-ready", "1");
      root.setAttribute("data-navsentinel-ui-guard", "stale-guard");
      expect(checkReadiness()).toBe(false);
      root.setAttribute("data-navsentinel-ui-guard", expectedGuard);
      expect(checkReadiness()).toBe(true);
      releaseReadiness();
      await waiting;
      expect(completed).toBe(true);
      expect(onboarding.close).toHaveBeenCalledOnce();
    } finally {
      root.removeAttribute("data-navsentinel-capture-ready");
      root.removeAttribute("data-navsentinel-bridge-ready");
      root.removeAttribute("data-navsentinel-ui-guard");
    }
  });

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
