import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveToken, makeToken, setActiveToken } from "../extension/src/shared/stateMachine";

let mockNow = 1000;

describe("stateMachine token lifecycle", () => {
  beforeEach(() => {
    mockNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => mockNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("freshly created token is retrievable", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "smart",
      cds: 45,
      reasonCodes: ["no_accessible_name"]
    });
    setActiveToken(token);
    expect(getActiveToken()).not.toBeNull();
    expect(getActiveToken()!.id).toBe(token.id);
  });

  it("token expires after 800ms", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "smart",
      cds: 30,
      reasonCodes: []
    });
    setActiveToken(token);

    // Just before expiry
    mockNow += 799;
    expect(getActiveToken()).not.toBeNull();

    // Past expiry boundary
    mockNow += 2;
    expect(getActiveToken()).toBeNull();
  });

  it("token is immediately available within the window", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "strict",
      cds: 0,
      reasonCodes: []
    });
    setActiveToken(token);

    mockNow += 400;
    const retrieved = getActiveToken();
    expect(retrieved).not.toBeNull();
    expect(retrieved!.siteKey).toBe("example.com");
  });

  it("new token replaces old token", () => {
    const first = makeToken({
      siteKey: "first.com",
      frameKey: "frame-0",
      mode: "smart",
      cds: 10,
      reasonCodes: []
    });
    setActiveToken(first);

    const second = makeToken({
      siteKey: "second.com",
      frameKey: "frame-1",
      mode: "strict",
      cds: 50,
      reasonCodes: ["retargeted_target_mismatch"]
    });
    setActiveToken(second);

    const active = getActiveToken();
    expect(active).not.toBeNull();
    expect(active!.siteKey).toBe("second.com");
    expect(active!.id).toBe(second.id);
  });

  it("expired token is cleaned up on access", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "smart",
      cds: 25,
      reasonCodes: []
    });
    setActiveToken(token);

    mockNow += 900;

    // First access returns null and cleans up
    expect(getActiveToken()).toBeNull();
    // Second access also returns null (not stale reference)
    expect(getActiveToken()).toBeNull();
  });

  it("token preserves pointer data when provided", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "smart",
      pointer: { x: 100, y: 200, button: 0, ctrl: false, shift: false, alt: false, meta: false },
      cds: 35,
      reasonCodes: ["intent_mismatch_under_interactive"]
    });
    setActiveToken(token);

    const active = getActiveToken()!;
    expect(active.type).toBe("pointer");
    expect(active.pointer).toBeDefined();
    expect(active.pointer!.x).toBe(100);
    expect(active.pointer!.y).toBe(200);
  });

  it("token without pointer data is keyboard type", () => {
    const token = makeToken({
      siteKey: "example.com",
      frameKey: "frame-0",
      mode: "smart",
      cds: 0,
      reasonCodes: ["keyboard_activation"]
    });
    setActiveToken(token);

    const active = getActiveToken()!;
    expect(active.type).toBe("keyboard");
    expect(active.pointer).toBeUndefined();
  });

  it("token id is unique across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = makeToken({
        siteKey: "example.com",
        frameKey: "frame-0",
        mode: "smart",
        cds: 0,
        reasonCodes: []
      });
      ids.add(token.id);
    }
    expect(ids.size).toBe(100);
  });

  it("token carries correct CDS and reason codes", () => {
    const token = makeToken({
      siteKey: "evil.com",
      frameKey: "frame-2",
      mode: "strict",
      cds: 65,
      reasonCodes: ["no_accessible_name", "overlay_large_interactive", "retargeted_target_mismatch"]
    });
    setActiveToken(token);

    const active = getActiveToken()!;
    expect(active.cds).toBe(65);
    expect(active.reasonCodes).toEqual([
      "no_accessible_name",
      "overlay_large_interactive",
      "retargeted_target_mismatch"
    ]);
    expect(active.mode).toBe("strict");
  });
});
