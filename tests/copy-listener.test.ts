// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  _resetClipboardEvents,
  clickFixToastPrefix,
  hasRecentClipboardWrite,
  hasRecentCommandClipboardWrite,
  scanForClickFix,
} from "../extension/src/content/clickfix_detector";
import { installCopyListener } from "../extension/src/content/copy_listener";

// Inert sentinel: classified command-like via the "base64" keyword, harmless anywhere.
const COMMAND_PAYLOAD = "NS_INERT base64 sample";

let enabled = true;
let scans = 0;

interface CopyOptions {
  trusted?: boolean;
  clipboardData?: "store" | null;
}

/** A copy event carrying a minimal clipboardData store, dispatched from `target`. */
function dispatchCopy(target: EventTarget, { trusted = true, clipboardData = "store" }: CopyOptions = {}): Event {
  let store = "";
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value:
      clipboardData === null
        ? null
        : { setData: (_type: string, value: string) => { store = value; }, getData: () => store },
  });
  // Real user copies are trusted; a synthetic page-dispatched copy is not.
  if (trusted) Object.defineProperty(event, "isTrusted", { value: true });
  target.dispatchEvent(event);
  return event;
}

function selectText(text: string, extraHtml = ""): void {
  document.body.innerHTML = `${extraHtml}<p id="sel">${text}</p>`;
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("sel")!);
  const selection = getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const sel = (): HTMLElement => document.getElementById("sel")!;

/** Run `fn` while a page listener on `target` rewrites (or just cancels) every copy. */
function withRewrite(target: EventTarget, payload: string | null, fn: () => void): void {
  const rewrite = (e: Event): void => {
    if (payload !== null) (e as ClipboardEvent).clipboardData?.setData("text/plain", payload);
    e.preventDefault();
  };
  target.addEventListener("copy", rewrite);
  try {
    fn();
  } finally {
    target.removeEventListener("copy", rewrite);
  }
}

beforeAll(() => {
  installCopyListener(() => enabled, () => { scans++; });
});

beforeEach(() => {
  _resetClipboardEvents();
  enabled = true;
  scans = 0;
  selectText("Hello world, a plain sentence");
});

describe("isolated-world copy listener (#1168)", () => {
  it("classifies the page-set payload when a page listener rewrites and cancels the copy", () => {
    withRewrite(document, COMMAND_PAYLOAD, () => dispatchCopy(sel()));
    expect(hasRecentCommandClipboardWrite()).toBe(true);
    expect(scans).toBe(1);
  });

  it("runs after a page window bubble listener registered before dispatch", () => {
    withRewrite(window, COMMAND_PAYLOAD, () => dispatchCopy(sel()));
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("records nothing for an ordinary selection copy, even of command-like text", () => {
    selectText(COMMAND_PAYLOAD);
    dispatchCopy(sel());
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scans).toBe(0);
  });

  it("records nothing when the cancelled copy carries no clipboardData or empty data", () => {
    withRewrite(document, COMMAND_PAYLOAD, () => dispatchCopy(sel(), { clipboardData: null }));
    withRewrite(document, null, () => dispatchCopy(sel()));
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scans).toBe(0);
  });

  it("ignores a synthetic untrusted copy", () => {
    withRewrite(document, COMMAND_PAYLOAD, () => dispatchCopy(sel(), { trusted: false }));
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scans).toBe(0);
  });

  it("records nothing while protection is off", () => {
    enabled = false;
    withRewrite(document, COMMAND_PAYLOAD, () => dispatchCopy(sel()));
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scans).toBe(0);
  });

  it("does not double-count after an earlier copy never bubbled to window", () => {
    const stop = (e: Event): void => e.stopPropagation();
    withRewrite(document, COMMAND_PAYLOAD, () => {
      document.addEventListener("copy", stop);
      try {
        dispatchCopy(sel());
      } finally {
        document.removeEventListener("copy", stop);
      }
      expect(scans).toBe(0); // documented residual: a stopped copy is not read

      dispatchCopy(sel());
    });
    expect(scans).toBe(1);
  });
});

describe("ordinary copies do not raise ClickFix (#1182 review)", () => {
  it("a selection copy of keyword-hitting prose beside a full-viewport overlay is not detected", () => {
    selectText("Please finish setup", '<div id="ov" style="position:fixed;inset:0;z-index:1000">Welcome</div>');
    const overlay = document.getElementById("ov")!;
    overlay.getBoundingClientRect = () =>
      ({ width: window.innerWidth, height: window.innerHeight, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }) as DOMRect;
    dispatchCopy(sel());
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scanForClickFix(document).detected).toBe(false);
  });

  it("a selection copy beside Run-dialog steps is not detected", () => {
    selectText(COMMAND_PAYLOAD, "<p>Press Win + R</p>");
    dispatchCopy(sel());
    expect(scanForClickFix(document).detected).toBe(false);
  });

  it("a page rewrite beside Run-dialog steps is detected", () => {
    selectText("Hello world", "<p>Press Win + R</p>");
    withRewrite(document, COMMAND_PAYLOAD, () => dispatchCopy(sel()));
    expect(scanForClickFix(document).detected).toBe(true);
  });
});

describe("clickFixToastPrefix", () => {
  it("does not claim a dialog for the overlay-free lure branch", () => {
    expect(clickFixToastPrefix(["clipboard_command_with_lure_text"])).toMatch(/File Explorer/);
    expect(clickFixToastPrefix(["clipboard_command_with_lure_text"])).not.toMatch(/dialog/);
  });

  it("keeps the dialog wording for overlay detections", () => {
    expect(clickFixToastPrefix(["clipboard_command_with_overlay", "clickfix_instruction_pattern"])).toMatch(/fake verification dialog/);
  });
});
