import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getLastVisualSimResult,
  resetVisualSimState,
} from "../extension/src/content/visual_sim_capture";

describe("visual_sim_capture", () => {
  beforeEach(() => {
    resetVisualSimState();
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
});
