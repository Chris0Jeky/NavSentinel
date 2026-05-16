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
    it("does not reuse a same-URL cache entry across cross-origin brand context", async () => {
      const sameOrigin = await triggerVisualSimCheck(false);
      const crossOrigin = await triggerVisualSimCheck(true);

      expect(sameOrigin.score).toBe(25);
      expect(crossOrigin.score).toBe(30);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("reuses a same-URL cache entry when cross-origin brand context is unchanged", async () => {
      const first = await triggerVisualSimCheck(true);
      const second = await triggerVisualSimCheck(true);

      expect(second).toBe(first);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("waitForStability", () => {
    it("resolves when document.body is not available yet", async () => {
      vi.stubGlobal("document", { body: null });

      await expect(waitForStability(1, 5)).resolves.toBe(true);
    });
  });
});
