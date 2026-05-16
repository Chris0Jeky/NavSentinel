import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  handleDblclickBridgeMessage,
  handleDblclickRuntimeMessage,
  isDoubleClickHijackActive,
  getDblclickOpenerNavUrl,
  _resetDblclickState,
} from "../extension/src/content/dblclick_guard";

describe("dblclick_guard", () => {
  beforeEach(() => {
    _resetDblclickState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("handleDblclickBridgeMessage", () => {
    it("handles ns-dblclick-window-open", () => {
      const result = handleDblclickBridgeMessage("ns-dblclick-window-open", {
        ts: Date.now(),
      });
      expect(result.handled).toBe(true);
      expect(result.forwardToSW).toBeUndefined();
    });

    it("handles ns-dblclick-opener-nav and returns forwardToSW", () => {
      const ts = Date.now();
      const result = handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts,
        url: "https://bank.example.com/transfer",
      });
      expect(result.handled).toBe(true);
      expect(result.forwardToSW).toEqual({
        type: "ns-dblclick-opener-nav",
        url: "https://bank.example.com/transfer",
        ts,
      });
    });

    it("handles ns-dblclick-second-click", () => {
      const result = handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: Date.now(),
      });
      expect(result.handled).toBe(true);
      expect(result.forwardToSW).toBeUndefined();
    });

    it("returns handled: false for unrelated types", () => {
      expect(handleDblclickBridgeMessage("ns-nav-blocked", {}).handled).toBe(false);
      expect(handleDblclickBridgeMessage("ns-clipboard-write", {}).handled).toBe(false);
      expect(handleDblclickBridgeMessage("", {}).handled).toBe(false);
    });

    it("defaults to Date.now() when ts is not a number", () => {
      const before = Date.now();
      const result = handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        url: "https://example.com",
      });
      expect(result.forwardToSW!.ts).toBeGreaterThanOrEqual(before);
      expect(result.forwardToSW!.ts).toBeLessThanOrEqual(Date.now());
    });

    it("defaults url to empty string when not provided", () => {
      const result = handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
      });
      expect(result.forwardToSW!.url).toBe("");
    });

    it("resets state on new window-open cycle", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now,
        url: "https://old.example.com",
      });
      expect(isDoubleClickHijackActive()).toBe(true);

      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now + 100 });
      expect(isDoubleClickHijackActive()).toBe(false);
      expect(getDblclickOpenerNavUrl()).toBe("");
    });
  });

  describe("handleDblclickRuntimeMessage", () => {
    it("handles ns-dblclick-child-closed", () => {
      expect(
        handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" })
      ).toBe(true);
    });

    it("handles ns-dblclick-opener-nav-from-child", () => {
      expect(
        handleDblclickRuntimeMessage({
          type: "ns-dblclick-opener-nav-from-child",
          url: "https://bank.example.com",
          ts: Date.now(),
        })
      ).toBe(true);
      expect(getDblclickOpenerNavUrl()).toBe("https://bank.example.com");
    });

    it("returns false for unrelated messages", () => {
      expect(handleDblclickRuntimeMessage({ type: "ns-nav-blocked" })).toBe(false);
      expect(handleDblclickRuntimeMessage({ type: "" })).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(handleDblclickRuntimeMessage(null)).toBe(false);
      expect(handleDblclickRuntimeMessage(undefined)).toBe(false);
    });

    it("defaults url to empty string for opener-nav-from-child", () => {
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
      });
      expect(getDblclickOpenerNavUrl()).toBe("");
    });
  });

  describe("isDoubleClickHijackActive", () => {
    it("returns false with no state", () => {
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("returns false with only window-open (no opener nav)", () => {
      handleDblclickBridgeMessage("ns-dblclick-window-open", {
        ts: Date.now(),
      });
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("returns true with window-open + opener-nav", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now + 100,
        url: "https://bank.example.com/transfer",
      });
      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("returns true with window-open + child-closed + opener-nav", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now + 50,
        url: "https://bank.example.com",
      });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });
      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("returns true with window-open + second-click + opener-nav", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now + 50,
        url: "https://bank.example.com",
      });
      handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: now + 200,
      });
      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("returns false when child-closed but no opener-nav", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("returns false when second-click but no opener-nav", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: now + 200,
      });
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("expires after DBLCLICK_HIJACK_STALE_MS (5000ms)", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now + 100,
        url: "https://bank.example.com",
      });
      expect(isDoubleClickHijackActive()).toBe(true);

      vi.advanceTimersByTime(4999);
      expect(isDoubleClickHijackActive()).toBe(true);

      vi.advanceTimersByTime(2);
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("expires when window-open goes stale even if opener-nav is fresh", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });

      vi.advanceTimersByTime(2000);
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com",
      });
      expect(isDoubleClickHijackActive()).toBe(true);

      vi.advanceTimersByTime(3001);
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("returns false when only opener-nav (no window-open)", () => {
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com",
      });
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("handles SW-forwarded opener nav via runtime message", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://bank.example.com",
        ts: now + 100,
      });
      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("activates via child-closed when opener-nav has stale ts", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://bank.example.com",
        ts: now - 5100,
      });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });

      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("expires child-closed signal after DBLCLICK_HIJACK_STALE_MS", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://bank.example.com",
        ts: now - 5100,
      });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });
      expect(isDoubleClickHijackActive()).toBe(true);

      vi.advanceTimersByTime(5001);
      expect(isDoubleClickHijackActive()).toBe(false);
    });

    it("activates via second-click when opener-nav has stale ts", () => {
      const now = Date.now();
      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://bank.example.com",
        ts: now - 5100,
      });
      handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: Date.now(),
      });

      expect(isDoubleClickHijackActive()).toBe(true);
    });
  });

  describe("getDblclickOpenerNavUrl", () => {
    it("returns empty string initially", () => {
      expect(getDblclickOpenerNavUrl()).toBe("");
    });

    it("returns url after opener-nav bridge message", () => {
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com/transfer",
      });
      expect(getDblclickOpenerNavUrl()).toBe(
        "https://bank.example.com/transfer"
      );
    });

    it("returns url after runtime opener-nav-from-child", () => {
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://evil.example.com",
        ts: Date.now(),
      });
      expect(getDblclickOpenerNavUrl()).toBe("https://evil.example.com");
    });

    it("is cleared on new window-open cycle", () => {
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com",
      });
      expect(getDblclickOpenerNavUrl()).toBe("https://bank.example.com");

      handleDblclickBridgeMessage("ns-dblclick-window-open", {
        ts: Date.now(),
      });
      expect(getDblclickOpenerNavUrl()).toBe("");
    });
  });

  describe("_resetDblclickState", () => {
    it("clears all state", () => {
      handleDblclickBridgeMessage("ns-dblclick-window-open", {
        ts: Date.now(),
      });
      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com",
      });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });
      handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: Date.now(),
      });

      expect(isDoubleClickHijackActive()).toBe(true);
      expect(getDblclickOpenerNavUrl()).toBe("https://bank.example.com");

      _resetDblclickState();

      expect(isDoubleClickHijackActive()).toBe(false);
      expect(getDblclickOpenerNavUrl()).toBe("");
    });
  });

  describe("full attack sequence", () => {
    it("detects classic doubleclickjacking pattern", () => {
      const now = Date.now();

      expect(isDoubleClickHijackActive()).toBe(false);

      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      expect(isDoubleClickHijackActive()).toBe(false);

      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: now + 300,
        url: "https://bank.example.com/authorize",
      });
      expect(isDoubleClickHijackActive()).toBe(true);

      handleDblclickBridgeMessage("ns-dblclick-second-click", {
        ts: now + 400,
      });
      expect(isDoubleClickHijackActive()).toBe(true);
      expect(getDblclickOpenerNavUrl()).toBe(
        "https://bank.example.com/authorize"
      );
    });

    it("detects child-close variant", () => {
      const now = Date.now();

      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
      handleDblclickRuntimeMessage({
        type: "ns-dblclick-opener-nav-from-child",
        url: "https://bank.example.com/oauth",
        ts: now + 200,
      });
      handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });

      expect(isDoubleClickHijackActive()).toBe(true);
    });

    it("does not false-positive on legitimate window.open + nav", () => {
      const now = Date.now();

      handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });

      vi.advanceTimersByTime(6000);

      handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
        ts: Date.now(),
        url: "https://bank.example.com",
      });
      expect(isDoubleClickHijackActive()).toBe(false);
    });
  });
});
