import { afterEach, beforeEach } from "vitest";

/**
 * Simulate trusted user input for prompt-control tests. (#826)
 *
 * happy-dom does not implement Event.isTrusted (reads undefined); Chrome marks
 * real input trusted and forbids forging (defineProperty throws — verified by
 * experiment against real Chromium). Patching the prototype getter makes every
 * synthesized UI event in the file read trusted, so existing `.click()` and
 * key/mousedown dispatches exercise the trusted path without per-site edits.
 * Negative cases forge `false` explicitly via {@link dispatchUntrusted}.
 */
export function stubTrustedInput(): void {
  beforeEach(() => {
    Object.defineProperty(Event.prototype, "isTrusted", {
      get: () => true,
      configurable: true,
    });
  });
  afterEach(() => {
    delete (Event.prototype as unknown as Record<string, unknown>).isTrusted;
  });
}

/** Dispatch an event that reads untrusted even under {@link stubTrustedInput}. */
export function dispatchUntrusted(target: EventTarget, event: Event): void {
  Object.defineProperty(event, "isTrusted", { value: false, configurable: true });
  target.dispatchEvent(event);
}
