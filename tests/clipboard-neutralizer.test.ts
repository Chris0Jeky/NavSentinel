// @vitest-environment happy-dom
/** ClickFix clipboard neutralization decision and writer (#1169). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const appendEvent = vi.fn(async (_entry: unknown) => {});
const showToast = vi.fn((_opts: { message: string }) => {});
vi.mock("../extension/src/shared/storage", () => ({ appendEvent: (entry: unknown) => appendEvent(entry) }));
vi.mock("../extension/src/content/ui_toast", () => ({ showToast: (opts: { message: string }) => showToast(opts) }));

import {
  _resetNeutralizer,
  CLIPBOARD_NEUTRALIZE_ENABLED,
  CLIPBOARD_REPLACED_TOAST,
  CLIPBOARD_WARNING_TEXT,
  MAX_NEUTRALIZATIONS_PER_PAGE,
  onClickFixReceipt,
  shouldNeutralizeClipboard,
  type NeutralizeInput,
} from "../extension/src/content/clipboard_neutralizer";

const COMMAND: NeutralizeInput = {
  mode: "smart",
  command: true,
  detected: true,
  reasons: ["clipboard_command_with_overlay", "clickfix_instruction_pattern"],
  score: 60,
};
/** A later page write with no lure left on the page. */
const BARE_COMMAND: NeutralizeInput = { ...COMMAND, detected: false, reasons: [], score: 0 };

/** A clipboard that holds a value, so tests can see what a paste would get. */
function fakeClipboard(impl?: () => Promise<void>) {
  const clip = {
    value: "",
    writeText: vi.fn((text: string) => {
      if (impl) return impl();
      clip.value = text;
      return Promise.resolve();
    }),
  };
  return clip;
}
const rejecting = () => fakeClipboard(() => Promise.reject(new DOMException("Document is not focused.", "NotAllowedError")));

describe("shouldNeutralizeClipboard", () => {
  it("defaults on", () => {
    expect(CLIPBOARD_NEUTRALIZE_ENABLED).toBe(true);
  });

  it("neutralizes a command receipt behind a lure in Smart and Strict", () => {
    expect(shouldNeutralizeClipboard(COMMAND)).toBe(true);
    expect(shouldNeutralizeClipboard({ ...COMMAND, mode: "strict" })).toBe(true);
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clipboard_command_with_lure_text"] })).toBe(true);
  });

  it("never acts in Off mode, sticky or not", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, mode: "off" })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, mode: "off" }, true)).toBe(false);
  });

  it("never acts on a benign current receipt, whatever older receipts said", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, command: false })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, command: false }, true)).toBe(false);
  });

  it("never acts on captcha text, a non-command write, or no detection", () => {
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clipboard_write_with_overlay", "clickfix_instruction_pattern"] })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, reasons: ["clickfix_captcha_text_with_overlay"] })).toBe(false);
    expect(shouldNeutralizeClipboard({ ...COMMAND, detected: false })).toBe(false);
  });

  it("stays on for a page already neutralized once", () => {
    expect(shouldNeutralizeClipboard(BARE_COMMAND)).toBe(false);
    expect(shouldNeutralizeClipboard(BARE_COMMAND, true)).toBe(true);
  });

  it("honours the product switch", () => {
    expect(shouldNeutralizeClipboard(COMMAND, true, false)).toBe(false);
  });
});

describe("onClickFixReceipt", () => {
  beforeEach(() => {
    _resetNeutralizer();
    appendEvent.mockClear();
    showToast.mockClear();
  });

  it("writes only the fixed warning text and never reads", async () => {
    const clip = fakeClipboard();
    await expect(onClickFixReceipt(COMMAND, clip)).resolves.toBe(true);
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(CLIPBOARD_WARNING_TEXT);
    expect(clip.value).toBe(CLIPBOARD_WARNING_TEXT);
  });

  it("leaves a benign copy alone after a command write with the overlay still present", async () => {
    const clip = fakeClipboard();
    await onClickFixReceipt(COMMAND, clip);
    clip.value = "847293"; // the page copies a 2FA code
    // The scan still reports the older command write in its 30 s window.
    await expect(onClickFixReceipt({ ...COMMAND, command: false }, clip)).resolves.toBe(false);
    expect(clip.value).toBe("847293");
  });

  it("is a no-op in Off mode and for non-command detections", async () => {
    const clip = fakeClipboard();
    await expect(onClickFixReceipt({ ...COMMAND, mode: "off" }, clip)).resolves.toBe(false);
    await expect(onClickFixReceipt({ ...COMMAND, reasons: ["clipboard_write_with_overlay"] }, clip)).resolves.toBe(false);
    expect(clip.writeText).not.toHaveBeenCalled();
  });

  it("shows the follow-up toast and journal entry only after a successful write", async () => {
    await expect(onClickFixReceipt(COMMAND, rejecting())).resolves.toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();

    await expect(onClickFixReceipt(COMMAND, fakeClipboard())).resolves.toBe(true);
    expect(showToast).toHaveBeenCalledExactlyOnceWith({ message: CLIPBOARD_REPLACED_TOAST, timeoutMs: 0 });
    expect(appendEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "clickfix_detected", reasons: ["clipboard_neutralized"], score: 60,
    }));
  });

  it("rate-limits the follow-up toast to once per 10 s", async () => {
    let t = 1_000_000;
    const clip = fakeClipboard();
    await onClickFixReceipt(COMMAND, clip, () => t);
    t += 5_000;
    await onClickFixReceipt(COMMAND, clip, () => t);
    expect(showToast).toHaveBeenCalledTimes(1);
    t += 5_000;
    await onClickFixReceipt(COMMAND, clip, () => t);
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it("swallows a rejected write, a synchronous throw and a missing clipboard", async () => {
    await expect(onClickFixReceipt(COMMAND, rejecting())).resolves.toBe(false);
    const throwing = { writeText: vi.fn(() => { throw new TypeError("no"); }) };
    await expect(onClickFixReceipt(COMMAND, throwing)).resolves.toBe(false);
    vi.stubGlobal("navigator", {});
    try {
      await expect(onClickFixReceipt(COMMAND)).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives up on a write that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = onClickFixReceipt(COMMAND, fakeClipboard(() => new Promise(() => {})));
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays sticky after one success: a bare command write later is still replaced", async () => {
    const clip = fakeClipboard();
    await expect(onClickFixReceipt(BARE_COMMAND, clip)).resolves.toBe(false);
    await onClickFixReceipt(COMMAND, clip);
    clip.value = "page command";
    await expect(onClickFixReceipt(BARE_COMMAND, clip)).resolves.toBe(true);
    expect(clip.value).toBe(CLIPBOARD_WARNING_TEXT);
  });

  it("is not sticky after only failed writes", async () => {
    await onClickFixReceipt(COMMAND, rejecting());
    await expect(onClickFixReceipt(BARE_COMMAND, fakeClipboard())).resolves.toBe(false);
  });

  it("counts only successful writes toward the per-page cap", async () => {
    expect(MAX_NEUTRALIZATIONS_PER_PAGE).toBe(50);
    const failing = rejecting();
    for (let i = 0; i < MAX_NEUTRALIZATIONS_PER_PAGE + 5; i++) await onClickFixReceipt(COMMAND, failing);
    const clip = fakeClipboard();
    for (let i = 0; i < MAX_NEUTRALIZATIONS_PER_PAGE; i++) {
      await expect(onClickFixReceipt(COMMAND, clip)).resolves.toBe(true);
    }
    await expect(onClickFixReceipt(COMMAND, clip)).resolves.toBe(false);
    expect(clip.writeText).toHaveBeenCalledTimes(MAX_NEUTRALIZATIONS_PER_PAGE);
  });
});
