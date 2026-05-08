import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  updateTabIcon,
  clearTabIcon,
  getTabIconState,
  setAllTabsGray,
  _getTabStateMap,
  type IconState,
} from "../extension/src/sw/icon_manager";

const setBadgeText = vi.fn().mockResolvedValue(undefined);
const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal("chrome", {
  action: {
    setBadgeText,
    setBadgeBackgroundColor,
  },
});

describe("icon_manager", () => {
  beforeEach(() => {
    _getTabStateMap().clear();
    setBadgeText.mockClear();
    setBadgeBackgroundColor.mockClear();
  });

  it("sets green badge with checkmark", async () => {
    await updateTabIcon(1, "green");
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 1,
      color: "#16a34a",
    });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 1, text: "✓" });
  });

  it("sets yellow badge with exclamation", async () => {
    await updateTabIcon(2, "yellow");
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 2,
      color: "#ca8a04",
    });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 2, text: "!" });
  });

  it("sets red badge with X mark", async () => {
    await updateTabIcon(3, "red");
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 3,
      color: "#dc2626",
    });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: "✕" });
  });

  it("clears badge for gray state", async () => {
    await updateTabIcon(4, "gray");
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 4, text: "" });
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it("uses block count as badge text when positive", async () => {
    await updateTabIcon(5, "red", 3);
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: "3" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 5,
      color: "#dc2626",
    });
  });

  it("skips duplicate state updates (no-op)", async () => {
    await updateTabIcon(6, "green");
    setBadgeText.mockClear();
    setBadgeBackgroundColor.mockClear();

    await updateTabIcon(6, "green");
    expect(setBadgeText).not.toHaveBeenCalled();
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it("updates when state changes on same tab", async () => {
    await updateTabIcon(7, "green");
    setBadgeText.mockClear();
    setBadgeBackgroundColor.mockClear();

    await updateTabIcon(7, "red");
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({
      tabId: 7,
      color: "#dc2626",
    });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "✕" });
  });

  it("updates when block count changes on same tab", async () => {
    await updateTabIcon(8, "red", 1);
    setBadgeText.mockClear();
    setBadgeBackgroundColor.mockClear();

    await updateTabIcon(8, "red", 2);
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: "2" });
  });

  describe("clearTabIcon", () => {
    it("removes tab state and clears badge", () => {
      _getTabStateMap().set(10, { icon: "red", blocks: 2 });
      clearTabIcon(10);
      expect(_getTabStateMap().has(10)).toBe(false);
      expect(setBadgeText).toHaveBeenCalledWith({ tabId: 10, text: "" });
    });

    it("works on unknown tab without error", () => {
      expect(() => clearTabIcon(999)).not.toThrow();
    });
  });

  describe("getTabIconState", () => {
    it("returns gray for unknown tab", () => {
      expect(getTabIconState(42)).toBe("gray");
    });

    it("returns current state for tracked tab", async () => {
      await updateTabIcon(11, "yellow");
      expect(getTabIconState(11)).toBe("yellow");
    });
  });

  describe("setAllTabsGray", () => {
    it("clears all tab states and badges", async () => {
      await updateTabIcon(20, "green");
      await updateTabIcon(21, "red", 1);
      setBadgeText.mockClear();

      await setAllTabsGray();
      expect(_getTabStateMap().size).toBe(0);
      expect(setBadgeText).toHaveBeenCalledTimes(2);
      expect(setBadgeText).toHaveBeenCalledWith({ tabId: 20, text: "" });
      expect(setBadgeText).toHaveBeenCalledWith({ tabId: 21, text: "" });
    });

    it("handles empty state gracefully", async () => {
      await setAllTabsGray();
      expect(_getTabStateMap().size).toBe(0);
    });
  });
});
