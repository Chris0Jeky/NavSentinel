import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClipboardBridgeWrite } from "../extension/src/content/clipboard_bridge";
import {
  _resetClipboardEvents,
  hasRecentClipboardWrite,
  hasRecentCommandClipboardWrite,
} from "../extension/src/content/clickfix_detector";

const NOW = 2_000_000_000_000;

describe("recordClipboardBridgeWrite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    _resetClipboardEvents();
  });

  afterEach(() => {
    _resetClipboardEvents();
    vi.useRealTimers();
  });

  it("ignores a future producer timestamp for expiry authority", () => {
    recordClipboardBridgeWrite({
      ts: NOW + 86_400_000,
      contentLength: 42,
      looksLikeCommand: true,
    });
    expect(hasRecentCommandClipboardWrite()).toBe(true);

    vi.advanceTimersByTime(30_001);
    expect(hasRecentClipboardWrite()).toBe(false);
  });

  it("keeps a freshly received event despite a stale producer timestamp", () => {
    recordClipboardBridgeWrite({
      ts: NOW - 86_400_000,
      contentLength: 12,
      looksLikeCommand: false,
    });

    expect(hasRecentClipboardWrite()).toBe(true);
  });
});
