/** ClickFix clipboard neutralization decision and writer (#1169). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetNeutralizer,
  CLIPBOARD_NEUTRALIZE_ENABLED,
  CLIPBOARD_WARNING_TEXT,
  MAX_NEUTRALIZATIONS_PER_PAGE,
  maybeNeutralizeClipboard,
  shouldNeutralizeClipboard,
  type NeutralizeInput,
} from "../extension/src/content/clipboard_neutralizer";

const COMMAND: NeutralizeInput = {
  mode: "smart",
  detected: true,
  reasons: ["clipboard_command_with_overlay", "clickfix_instruction_pattern"],
};

function fakeClipboard(impl: () => Promise<void> = () => Promise.resolve()) {
  return { writeText: vi.fn((_text: string) => impl()) };
}

describe("shouldNeutralizeClipboard", () => {
  it("defaults on", () => {
    expect(CLIPBOARD_NEUTRALIZE_ENABLED).toBe(true);
  });

  it("neutralizes a detected command-like write in Smart and Strict", () => {
    expect(shouldNeutralizeClipboard(COMMAND)).toBe(true);
    expect(shouldNeutralizeClipboard({ ...COMMAND, mode: "strict" })).toBe(true);
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clipboard_command_with_lure_text"] })).toBe(true);
  });

  it("never acts in Off mode", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, mode: "off" })).toBe(false);
  });

  it("never acts without a detection", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, detected: false })).toBe(false);
  });

  it("never acts on captcha text or a non-command write", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clipboard_write_with_overlay", "clickfix_instruction_pattern"] })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clickfix_captcha_text_with_overlay"] })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: [] })).toBe(false);
  });

  it("honours the product switch", () => {
    expect(shouldNeutralizeClipboard(COMMAND, false)).toBe(false);
  });
});

describe("maybeNeutralizeClipboard", () => {
  beforeEach(() => _resetNeutralizer());

  it("writes only the fixed warning text and never reads", async () => {
    const clip = fakeClipboard();
    await expect(maybeNeutralizeClipboard(COMMAND, clip)).resolves.toBe(true);
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(CLIPBOARD_WARNING_TEXT);
    expect(Object.keys(clip)).toEqual(["writeText"]);
  });

  it("is a no-op in Off mode and for non-command detections", async () => {
    const clip = fakeClipboard();
    await expect(maybeNeutralizeClipboard({ ...COMMAND, mode: "off" }, clip)).resolves.toBe(false);
    await expect(maybeNeutralizeClipboard({ ...COMMAND, reasons: ["clipboard_write_with_overlay"] }, clip)).resolves.toBe(false);
    expect(clip.writeText).not.toHaveBeenCalled();
  });

  it("swallows a rejected write (no focus or activation)", async () => {
    const clip = fakeClipboard(() => Promise.reject(new DOMException("Document is not focused.", "NotAllowedError")));
    await expect(maybeNeutralizeClipboard(COMMAND, clip)).resolves.toBe(false);
  });

  it("swallows a synchronous throw and a missing clipboard", async () => {
    const clip = { writeText: vi.fn(() => { throw new TypeError("no"); }) };
    await expect(maybeNeutralizeClipboard(COMMAND, clip)).resolves.toBe(false);
    await expect(maybeNeutralizeClipboard(COMMAND, undefined)).resolves.toBe(false);
  });

  it("gives up on a write that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = maybeNeutralizeClipboard(COMMAND, fakeClipboard(() => new Promise(() => {})));
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-neutralizes per page write, bounded per page load", async () => {
    const clip = fakeClipboard();
    for (let i = 0; i < MAX_NEUTRALIZATIONS_PER_PAGE; i++) {
      await expect(maybeNeutralizeClipboard(COMMAND, clip)).resolves.toBe(true);
    }
    await expect(maybeNeutralizeClipboard(COMMAND, clip)).resolves.toBe(false);
    expect(clip.writeText).toHaveBeenCalledTimes(MAX_NEUTRALIZATIONS_PER_PAGE);
  });
});
