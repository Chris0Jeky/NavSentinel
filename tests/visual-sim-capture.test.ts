import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getLastVisualSimResult,
  resetVisualSimState,
  triggerVisualSimCheck,
  waitForStability,
} from "../extension/src/content/visual_sim_capture";

const templateMock = vi.hoisted(() => {
  const template = {
    id: "brand-login",
    displayName: "Brand Login",
    aHash: new Uint8Array(8),
    bHash: new Uint8Array(32),
    version: 1,
  };

  return {
    template,
    isLoaded: vi.fn(() => true),
    findAHashCandidates: vi.fn(() => [{ template, distance: 0 }]),
    confirmBHashMatch: vi.fn(() => ({ matched: true, distance: 0 })),
    computeVisualSimScore: vi.fn((_, isCrossOriginFromBrand: boolean) =>
      isCrossOriginFromBrand ? 30 : 25
    ),
  };
});

const hashMock = vi.hoisted(() => ({
  computeAHash: vi.fn(() => new Uint8Array(8)),
  computeBHash: vi.fn(() => new Uint8Array(32)),
}));

vi.mock("../extension/src/shared/visual_sim_templates", () => templateMock);
vi.mock("../extension/src/shared/visual_sim_hash", () => hashMock);

class MockOffscreenCanvas {
  constructor(
    public width: number,
    public height: number
  ) {}

  getContext(): {
    drawImage: () => void;
    getImageData: () => { data: Uint8ClampedArray };
  } {
    return {
      drawImage: vi.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(this.width * this.height * 4),
      }),
    };
  }
}

describe("visual_sim_capture", () => {
  beforeEach(() => {
    resetVisualSimState();
    vi.clearAllMocks();
    templateMock.isLoaded.mockReturnValue(true);
    templateMock.findAHashCandidates.mockReturnValue([{ template: templateMock.template, distance: 0 }]);
    templateMock.confirmBHashMatch.mockReturnValue({ matched: true, distance: 0 });
    templateMock.computeVisualSimScore.mockImplementation((_, isCrossOriginFromBrand: boolean) =>
      isCrossOriginFromBrand ? 30 : 25
    );

    vi.stubGlobal("chrome", {
      runtime: {
        lastError: null,
        sendMessage: vi.fn((_message, callback) => callback({ dataUrl: "data:image/png;base64,AA==" })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob()) })));
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve({ close: vi.fn() })));
    vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
    vi.stubGlobal("location", { href: "https://login.example.test/account" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("state management", () => {
    it("getLastVisualSimResult returns null initially", () => {
      expect(getLastVisualSimResult()).toBeNull();
    });

    it("resetVisualSimState clears state", () => {
      resetVisualSimState();
      expect(getLastVisualSimResult()).toBeNull();
    });
  });

  describe("triggerVisualSimCheck", () => {
    it("captures once per URL and only re-scores across the cross-origin flag", async () => {
      // FIX 3: the screenshot/hash/match are flag-independent, so the same URL
      // must capture exactly once even though the two passes use different flags.
      const sameOrigin = await triggerVisualSimCheck(false);
      const crossOrigin = await triggerVisualSimCheck(true);

      expect(sameOrigin.score).toBe(25);
      expect(crossOrigin.score).toBe(30);
      // Both passes share the URL-keyed capture cache: one capture only.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
      // The match object is populated on both passes (so the caller can look up
      // the canonical domain even when the score would be 0).
      expect(sameOrigin.match?.brandId).toBe("brand-login");
      expect(crossOrigin.match?.brandId).toBe("brand-login");
    });

    it("reuses a same-URL cache entry when the cross-origin flag is unchanged", async () => {
      await triggerVisualSimCheck(true);
      await triggerVisualSimCheck(true);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("re-captures and recomputes after an SPA navigation clears the cache", async () => {
      // FIX 1: a route change resets the capture cache, so the next check for
      // the new URL must re-capture rather than serve a stale cached score.
      const first = await triggerVisualSimCheck(true);
      expect(first.score).toBe(30);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

      // Simulate an in-page navigation: new route + state reset.
      vi.stubGlobal("location", { href: "https://login.example.test/other" });
      resetVisualSimState();
      expect(getLastVisualSimResult()).toBeNull();

      const second = await triggerVisualSimCheck(true);
      expect(second.score).toBe(30);
      // A fresh capture happened for the new route (no stale reuse).
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe("waitForStability", () => {
    it("resolves when document.body is not available yet", async () => {
      vi.stubGlobal("document", { body: null });

      await expect(waitForStability(1, 5)).resolves.toBe(true);
    });
  });
});
