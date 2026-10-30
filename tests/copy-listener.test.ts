// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  _resetClipboardEvents,
  hasRecentClipboardWrite,
  hasRecentCommandClipboardWrite,
} from "../extension/src/content/clickfix_detector";
import { installCopyListener } from "../extension/src/content/copy_listener";

// Inert sentinel: classified command-like via the "base64" keyword, harmless anywhere.
const COMMAND_PAYLOAD = "NS_INERT base64 sample";

let enabled = true;
let scans = 0;

/** A copy event carrying a minimal clipboardData store, dispatched from `target`. */
function dispatchCopy(target: EventTarget): Event {
  let store = "";
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (_type: string, value: string) => { store = value; }, getData: () => store },
  });
  target.dispatchEvent(event);
  return event;
}

function selectText(text: string): void {
  document.body.innerHTML = `<p id="sel">${text}</p>`;
  const range = document.createRange();
  range.selectNodeContents(document.getElementById("sel")!);
  const selection = getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
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
    const rewrite = (e: Event): void => {
      (e as ClipboardEvent).clipboardData!.setData("text/plain", COMMAND_PAYLOAD);
      e.preventDefault();
    };
    document.addEventListener("copy", rewrite);
    try {
      dispatchCopy(document.getElementById("sel")!);
    } finally {
      document.removeEventListener("copy", rewrite);
    }
    expect(hasRecentCommandClipboardWrite()).toBe(true);
    expect(scans).toBe(1);
  });

  it("runs after a page window bubble listener registered before dispatch", () => {
    const rewrite = (e: Event): void => {
      (e as ClipboardEvent).clipboardData!.setData("text/plain", COMMAND_PAYLOAD);
      e.preventDefault();
    };
    window.addEventListener("copy", rewrite);
    try {
      dispatchCopy(document.getElementById("sel")!);
    } finally {
      window.removeEventListener("copy", rewrite);
    }
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("classifies the selection for an uncancelled copy", () => {
    dispatchCopy(document.getElementById("sel")!);
    expect(hasRecentClipboardWrite()).toBe(true);
    expect(hasRecentCommandClipboardWrite()).toBe(false);

    _resetClipboardEvents();
    selectText(COMMAND_PAYLOAD);
    dispatchCopy(document.getElementById("sel")!);
    expect(hasRecentCommandClipboardWrite()).toBe(true);
  });

  it("records nothing while protection is off", () => {
    enabled = false;
    selectText(COMMAND_PAYLOAD);
    dispatchCopy(document.getElementById("sel")!);
    expect(hasRecentClipboardWrite()).toBe(false);
    expect(scans).toBe(0);
  });

  it("does not double-count after an earlier copy never bubbled to window", () => {
    const stop = (e: Event): void => e.stopPropagation();
    document.addEventListener("copy", stop);
    try {
      dispatchCopy(document.getElementById("sel")!);
    } finally {
      document.removeEventListener("copy", stop);
    }
    expect(scans).toBe(0); // documented residual: a stopped copy is not read

    dispatchCopy(document.getElementById("sel")!);
    expect(scans).toBe(1);
  });
});
