/**
 * Own-extension sender gate for content-script runtime listeners. (#815)
 *
 * `chrome.tabs.sendMessage(tabId, ...)` from ANY co-installed extension is
 * delivered to every content-script `onMessage` listener in the tab, so each
 * listener must reject foreign senders. These tests pin the gate helper plus
 * a structural guarantee that every `onMessage.addListener` in
 * capture_isolated.ts actually applies it (a forgotten gate on a new listener
 * is exactly how this class recurs).
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOwnExtensionRuntimeSender } from "../extension/src/content/runtime_sender";

describe("isOwnExtensionRuntimeSender (#815)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the own-extension sender id", () => {
    vi.stubGlobal("chrome", { runtime: { id: "own-id" } });
    expect(isOwnExtensionRuntimeSender({ id: "own-id" })).toBe(true);
  });

  it("rejects a foreign extension sender id", () => {
    vi.stubGlobal("chrome", { runtime: { id: "own-id" } });
    expect(isOwnExtensionRuntimeSender({ id: "evil-id" })).toBe(false);
  });

  it("rejects a missing sender or missing sender id", () => {
    vi.stubGlobal("chrome", { runtime: { id: "own-id" } });
    expect(isOwnExtensionRuntimeSender(undefined)).toBe(false);
    expect(isOwnExtensionRuntimeSender(null)).toBe(false);
    expect(isOwnExtensionRuntimeSender({})).toBe(false);
  });

  it("rejects when the own id is unavailable (fail closed)", () => {
    vi.stubGlobal("chrome", { runtime: {} });
    expect(isOwnExtensionRuntimeSender({ id: "own-id" })).toBe(false);
    vi.stubGlobal("chrome", undefined);
    expect(isOwnExtensionRuntimeSender({ id: "own-id" })).toBe(false);
  });
});

describe("capture_isolated listener sender gates (#815)", () => {
  const src = readFileSync(
    resolve(__dirname, "..", "extension", "src", "content", "capture_isolated.ts"),
    "utf-8",
  );

  it("every onMessage listener declares the sender parameter", () => {
    expect(src).not.toMatch(/onMessage\.addListener\(\(message\)\s*=>/);
  });

  it("every onMessage listener applies the own-extension gate", () => {
    const listeners = src.match(/onMessage\.addListener\(/g) ?? [];
    const gates = src.match(/isOwnExtensionRuntimeSender\(sender\)/g) ?? [];
    expect(listeners.length).toBeGreaterThanOrEqual(4);
    expect(gates.length).toBeGreaterThanOrEqual(listeners.length);
  });
});
