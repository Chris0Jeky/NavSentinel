import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetDblclickState,
  consumeDblclickCorrelationOnTrustedClick,
  getDblclickOpenerNavUrl,
  handleDblclickBridgeMessage,
  handleDblclickRuntimeMessage,
  isDoubleClickHijackActive,
} from "../extension/src/content/dblclick_guard";

describe("dblclick_guard", () => {
  beforeEach(() => {
    _resetDblclickState();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("forwards a child opener-navigation bridge message", () => {
    const ts = Date.now();
    expect(handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts,
      url: "https://bank.example/transfer?private=1",
    })).toEqual({
      handled: true,
      forwardToSW: {
        type: "ns-dblclick-opener-nav",
        ts,
        url: "https://bank.example/transfer?private=1",
      },
    });
  });

  it("ignores unrelated bridge and runtime messages", () => {
    expect(handleDblclickBridgeMessage("ns-nav-blocked", {}).handled).toBe(false);
    expect(handleDblclickRuntimeMessage({ type: "ns-nav-blocked" })).toBe(false);
    expect(handleDblclickRuntimeMessage(null)).toBe(false);
  });

  it("requires a second click after opener navigation for same-document evidence", () => {
    const now = Date.now();
    handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
    handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts: now + 100,
      url: "https://bank.example/transfer",
    });

    expect(isDoubleClickHijackActive()).toBe(false);

    handleDblclickBridgeMessage("ns-dblclick-second-click", { ts: now + 200 });
    expect(isDoubleClickHijackActive()).toBe(true);
  });

  it("does not treat child close as a replacement for the second click", () => {
    const now = Date.now();
    handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
    handleDblclickRuntimeMessage({
      type: "ns-dblclick-opener-nav-from-child",
      ts: now + 100,
      url: "https://bank.example/transfer",
    });
    handleDblclickRuntimeMessage({ type: "ns-dblclick-child-closed" });

    expect(isDoubleClickHijackActive()).toBe(false);
  });

  it("requires the opener navigation before the second click", () => {
    const now = Date.now();
    handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
    handleDblclickBridgeMessage("ns-dblclick-second-click", { ts: now + 100 });
    handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts: now + 200,
      url: "https://bank.example/transfer",
    });

    expect(isDoubleClickHijackActive()).toBe(false);
  });

  it("expires same-document evidence", () => {
    const now = Date.now();
    handleDblclickBridgeMessage("ns-dblclick-window-open", { ts: now });
    handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts: now + 100,
      url: "https://bank.example/transfer",
    });
    handleDblclickBridgeMessage("ns-dblclick-second-click", { ts: now + 200 });
    expect(isDoubleClickHijackActive()).toBe(true);

    vi.advanceTimersByTime(5001);
    expect(isDoubleClickHijackActive()).toBe(false);
  });

  it("consumes a cross-document correlation exactly once for a trusted click", () => {
    const expiresAt = Date.now() + 5000;
    expect(handleDblclickRuntimeMessage({
      type: "ns-dblclick-correlation-ready",
      expiresAt,
      token: "a".repeat(32),
    })).toBe(true);

    expect(consumeDblclickCorrelationOnTrustedClick(false)).toBeNull();
    expect(consumeDblclickCorrelationOnTrustedClick(true)).toBe("a".repeat(32));
    expect(consumeDblclickCorrelationOnTrustedClick(true)).toBeNull();
  });

  it("rejects expired or oversized cross-document correlation records", () => {
    expect(handleDblclickRuntimeMessage({
      type: "ns-dblclick-correlation-ready",
      expiresAt: Date.now(),
      token: "a".repeat(32),
    })).toBe(false);
    expect(handleDblclickRuntimeMessage({
      type: "ns-dblclick-correlation-ready",
      expiresAt: Date.now() + 5001,
      token: "a".repeat(32),
    })).toBe(false);
    expect(consumeDblclickCorrelationOnTrustedClick(true)).toBeNull();
  });

  it("does not retain the opener URL when using cross-document evidence", () => {
    handleDblclickRuntimeMessage({
      type: "ns-dblclick-correlation-ready",
      expiresAt: Date.now() + 5000,
      token: "a".repeat(32),
    });
    expect(consumeDblclickCorrelationOnTrustedClick(true)).toBe("a".repeat(32));
    expect(getDblclickOpenerNavUrl()).toBe("");
  });

  it("resets every correlation state", () => {
    handleDblclickRuntimeMessage({
      type: "ns-dblclick-correlation-ready",
      expiresAt: Date.now() + 5000,
      token: "a".repeat(32),
    });
    _resetDblclickState();
    expect(consumeDblclickCorrelationOnTrustedClick(true)).toBeNull();
    expect(getDblclickOpenerNavUrl()).toBe("");
  });
});
