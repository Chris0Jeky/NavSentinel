import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPushStateState,
  handlePushStateBridgeMessage,
  isPushStateAbuseActive,
} from "../extension/src/content/pushstate_guard";
import {
  _resetDblclickState,
  handleDblclickBridgeMessage,
  isDoubleClickHijackActive,
} from "../extension/src/content/dblclick_guard";

const NOW = 2_000_000_000_000;
const sourceRoot = path.resolve(import.meta.dirname, "../extension/src/content");

describe("bridge signal clock authority", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    _resetPushStateState();
    _resetDblclickState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires a PushState signal by local receipt time even when the producer clock is far ahead", () => {
    handlePushStateBridgeMessage("ns-pushstate-suspicious", {
      ts: NOW + 86_400_000,
      url: "/accounts.example/login",
    });
    expect(isPushStateAbuseActive()).toBe(true);

    vi.advanceTimersByTime(10_001);
    expect(isPushStateAbuseActive()).toBe(false);
  });

  it("treats a freshly received PushState signal as fresh even when the producer clock is stale", () => {
    handlePushStateBridgeMessage("ns-pushstate-suspicious", {
      ts: NOW - 86_400_000,
      url: "/accounts.example/login",
    });

    expect(isPushStateAbuseActive()).toBe(true);
  });

  it("expires double-click state by local receipt time even when producer timestamps are far ahead", () => {
    handleDblclickBridgeMessage("ns-dblclick-window-open", {
      ts: NOW + 86_400_000,
    });
    handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts: NOW + 86_400_100,
      url: "https://bank.example/transfer",
    });
    expect(isDoubleClickHijackActive()).toBe(true);

    vi.advanceTimersByTime(5_001);
    expect(isDoubleClickHijackActive()).toBe(false);
  });

  it("keeps freshly received double-click state active when producer timestamps are stale", () => {
    handleDblclickBridgeMessage("ns-dblclick-window-open", {
      ts: NOW - 86_400_000,
    });
    const result = handleDblclickBridgeMessage("ns-dblclick-opener-nav", {
      ts: NOW - 86_399_900,
      url: "https://bank.example/transfer",
    });

    expect(isDoubleClickHijackActive()).toBe(true);
    expect(result.forwardToSW?.ts).toBe(NOW);
  });

  it("wires MAIN-world timing through an initialization-captured clock", () => {
    const source = fs.readFileSync(path.join(sourceRoot, "main_guard.ts"), "utf8");

    expect(source).toContain(
      'import { mainWorldNowMs as nowMs } from "./main_world_clock";',
    );
    expect(source).not.toMatch(/function nowMs\(\): number \{\s*return Date\.now\(\);\s*\}/u);
  });

  it("routes clipboard bridge events through a local-arrival adapter", () => {
    const source = fs.readFileSync(path.join(sourceRoot, "capture_isolated.ts"), "utf8");

    expect(source).toContain(
      'import { recordClipboardBridgeWrite } from "./clipboard_bridge";',
    );
    expect(source).toContain("recordClipboardBridgeWrite({");
    expect(source).not.toContain("recordClipboardWrite({ ts,");
  });
});
