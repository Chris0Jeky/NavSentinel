// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetFullscreenGuard,
  guardFullscreen,
  isScarewareFullscreen,
  onFullscreenChange,
} from "../extension/src/content/fullscreen_guard";
import { appendEvent } from "../extension/src/shared/storage";
import { showToast } from "../extension/src/content/ui_toast";

vi.mock("../extension/src/shared/storage", () => ({ appendEvent: vi.fn(() => Promise.resolve()) }));
vi.mock("../extension/src/content/ui_toast", () => ({ showToast: vi.fn() }));

const SCARE_TEXT =
  "WARNING! Your computer has been locked. Virus detected. Do not close this window. " +
  "Call Microsoft Support now at 1-800-555-0142.";

function div(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function rect(el: Element, width: number, height: number): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ width, height } as DOMRect);
}

beforeEach(() => {
  document.body.innerHTML = "";
  _resetFullscreenGuard();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isScarewareFullscreen", () => {
  it("flags the locker: scare wording plus a toll-free number", () => {
    const verdict = isScarewareFullscreen(div(`<h1>Security alert</h1><p>${SCARE_TEXT}</p>`));
    expect(verdict).toEqual({
      scare: true,
      reasons: ["fullscreen_scare_text", "fullscreen_phone_number"],
    });
  });

  it("matches wording split across inline elements", () => {
    const el = div("<p>Your computer <b>has been</b> locked. Call <i>Windows</i> support: (888) 555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it.each([
    ["US toll-free with parentheses", "(844) 555-0111"],
    ["US toll-free with +1", "+1 877 555 0123"],
    ["UK freephone", "0800 555 0199"],
    ["UK freephone 0808", "0808 555 0199"],
    ["international", "+44 20 7946 0999"],
  ])("recognises the phone format: %s", (_name, phone) => {
    const el = div(`<p>Virus detected. Do not close this page. Call ${phone}</p>`);
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it("combines three weak scare words", () => {
    const el = div("<p>Error code 0x80070005, firewall breach, trojan on disk. Call 1-800-555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it("combines one specific phrase with one weak word", () => {
    const el = div("<p>Virus detected. Error code 0x80070005. Call 1-800-555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it("does not flag two weak scare words beside a phone number", () => {
    const el = div("<p>Error code 0x80070005 firewall breach. Call 1-800-555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("does not flag a proctored exam banner with a support line", () => {
    const el = div("<h1>Final exam in progress</h1><p>Do not close this window until you submit. Technical issues? Exam support: 1-800-555-0123.</p>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("does not flag a security-awareness slide that quotes one scam phrase", () => {
    const el = div("<h1>Spot the scam</h1><p>A pop-up saying virus detected is fake. Report it to the help desk: 1-888-555-0188.</p>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("does not flag scare wording without a phone number", () => {
    const verdict = isScarewareFullscreen(div("<p>Your computer has been locked. Virus detected. Do not close this window.</p>"));
    expect(verdict.scare).toBe(false);
    expect(verdict.reasons).toEqual(["fullscreen_scare_text"]);
  });

  it("does not flag a phone number without scare wording", () => {
    const verdict = isScarewareFullscreen(div("<p>Questions about the venue? Call 1-800-555-0100 or +44 20 7946 0999.</p>"));
    expect(verdict.scare).toBe(false);
    expect(verdict.reasons).toEqual(["fullscreen_phone_number"]);
  });

  it("does not flag a single weak scare word beside a phone number", () => {
    const el = div("<p>Firewall rules slide. Contact 1-800-555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("does not flag a docs page that mentions viruses and numbers", () => {
    const el = div("<h1>How antivirus works</h1><p>A virus detected by a scanner is quarantined. Section 1800 covers 555 files.</p>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("does not flag a slide deck without scare text", () => {
    const el = div("<section><h1>Q3 roadmap</h1><ul><li>Ship v2</li><li>Hire two engineers</li></ul></section>");
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it.each(["video", "canvas", "iframe"])("never flags a bare <%s>, whatever its fallback text says", (tag) => {
    const el = document.createElement(tag);
    el.textContent = SCARE_TEXT;
    document.body.appendChild(el);
    expect(isScarewareFullscreen(el)).toEqual({ scare: false, reasons: [] });
  });

  it("never flags a container where a canvas fills most of the element", () => {
    const el = div(`<canvas></canvas><p>${SCARE_TEXT}</p>`);
    rect(el, 1000, 800);
    rect(el.querySelector("canvas")!, 1000, 700);
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("treats a container with an unmeasurable layout as media-dominated", () => {
    const el = div(`<video></video><p>${SCARE_TEXT}</p>`);
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("still flags text that only sits beside a small video", () => {
    const el = div(`<video></video><p>${SCARE_TEXT}</p>`);
    rect(el, 1000, 800);
    rect(el.querySelector("video")!, 100, 80);
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it("ignores CSS-hidden text such as an unshown slide (Codex P2 on #1210)", () => {
    const deck = (style: string) =>
      div(`<section><h1>Slide 3: phishing awareness</h1></section><section style="${style}"><p>${SCARE_TEXT}</p></section>`);
    expect(isScarewareFullscreen(deck("display: none")).scare).toBe(false);
    expect(isScarewareFullscreen(deck("")).scare).toBe(true);
    // A visibility:hidden or display:contents wrapper still renders its children: still read.
    const wrapped = (style: string) =>
      div(`<div style="${style}"><p style="visibility: visible">${SCARE_TEXT}</p></div>`);
    expect(isScarewareFullscreen(wrapped("visibility: hidden")).scare).toBe(true);
    expect(isScarewareFullscreen(wrapped("display: contents")).scare).toBe(true);
  });

  it("ignores script, style and hidden text", () => {
    const el = div(`<script>${SCARE_TEXT}</script><style>${SCARE_TEXT}</style><div hidden>${SCARE_TEXT}</div><p>Hello</p>`);
    expect(isScarewareFullscreen(el)).toEqual({ scare: false, reasons: [] });
  });

  it("reads only a bounded prefix of very long text", () => {
    const el = div(`<p>${"filler ".repeat(1000)}${SCARE_TEXT}</p>`);
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it.each([
    ["wide gaps", `your computer${" ".repeat(5000)}is locked`],
    ["repeated near-miss vendors", `call ${"microsoft ".repeat(600)}`],
    ["repeated near-miss digits", `+1${" 12".repeat(1700)}`],
    ["repeated freephone starts", `0800${" 123".repeat(1200)}`],
    ["repeated toll-free starts", `1 800 ${"555 ".repeat(1200)}`],
    ["repeated near-miss virus", `virus${"s".repeat(5000)}`],
  ])("scans adversarial near-miss text in bounded time: %s", (_name, text) => {
    const el = div(`<p>${text}</p>`);
    const started = Date.now();
    isScarewareFullscreen(el);
    // A backtracking-prone pattern would take seconds to forever on 5000 chars.
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe("Gym fixtures", () => {
  const load = (name: string, id: string): Element => {
    const html = readFileSync(`gym/${name}`, "utf8");
    // Attach it, as a real fullscreen element is, so computed styles resolve.
    return document.body.appendChild(document.adoptNode(new DOMParser().parseFromString(html, "text/html").getElementById(id)!));
  };

  it("classifies the attack fixture as a locker", () => {
    expect(isScarewareFullscreen(load("rw-fullscreen-locker.html", "locker")).scare).toBe(true);
  });

  it("leaves the benign slide alone", () => {
    expect(isScarewareFullscreen(load("rw-fullscreen-benign.html", "slide")).scare).toBe(false);
  });

  it("leaves the benign canvas player alone", () => {
    expect(isScarewareFullscreen(load("rw-fullscreen-benign.html", "player")).scare).toBe(false);
  });
});

describe("guardFullscreen", () => {
  function fullscreen(el: Element | null) {
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => el });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    return exit;
  }

  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  });

  it("exits fullscreen for the locker and asks for a notice", () => {
    const exit = fullscreen(div(`<p>${SCARE_TEXT}</p>`));
    expect(guardFullscreen(1000)).toEqual({
      reasons: ["fullscreen_scare_text", "fullscreen_phone_number"],
      notify: true,
    });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("leaves benign fullscreen alone", () => {
    const exit = fullscreen(div("<h1>Slides</h1>"));
    expect(guardFullscreen()).toBeNull();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is fullscreen", () => {
    const exit = fullscreen(null);
    expect(guardFullscreen()).toBeNull();
    expect(exit).not.toHaveBeenCalled();
  });

  it("keeps exiting on re-entry but notifies at most once per 10 s", () => {
    const exit = fullscreen(div(`<p>${SCARE_TEXT}</p>`));
    expect(guardFullscreen(1000)?.notify).toBe(true);
    expect(guardFullscreen(5000)?.notify).toBe(false);
    expect(guardFullscreen(11_000)?.notify).toBe(true);
    expect(exit).toHaveBeenCalledTimes(3);
  });

  it("stops after 20 exits per page load", () => {
    const exit = fullscreen(div(`<p>${SCARE_TEXT}</p>`));
    for (let i = 0; i < 25; i++) guardFullscreen(i);
    expect(exit).toHaveBeenCalledTimes(20);
  });

  it("onFullscreenChange marks the tab, journals and toasts once per notice", () => {
    vi.mocked(appendEvent).mockClear();
    vi.mocked(showToast).mockClear();
    fullscreen(div(`<p>${SCARE_TEXT}</p>`));
    const markRed = vi.fn();
    onFullscreenChange(markRed);
    onFullscreenChange(markRed); // re-entry inside 10 s: exits again, no second notice
    expect(markRed).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "fullscreen_locker_exit",
      reasons: ["fullscreen_scare_text", "fullscreen_phone_number"],
    }));
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("onFullscreenChange stays silent for benign fullscreen", () => {
    vi.mocked(showToast).mockClear();
    fullscreen(div("<h1>Slides</h1>"));
    const markRed = vi.fn();
    onFullscreenChange(markRed);
    expect(markRed).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("survives exitFullscreen rejecting", async () => {
    fullscreen(div(`<p>${SCARE_TEXT}</p>`));
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("denied")),
    });
    expect(guardFullscreen(1000)?.notify).toBe(true);
    await Promise.resolve();
  });
});
