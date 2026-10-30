// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetFullscreenGuard,
  guardFullscreen,
  isScarewareFullscreen,
} from "../extension/src/content/fullscreen_guard";

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
    ["international", "+44 20 7946 0999"],
  ])("recognises the phone format: %s", (_name, phone) => {
    const el = div(`<p>Virus detected. Do not close this page. Call ${phone}</p>`);
    expect(isScarewareFullscreen(el).scare).toBe(true);
  });

  it("combines two weak scare words", () => {
    const el = div("<p>Error code 0x80070005 firewall breach. Call 1-800-555-0100</p>");
    expect(isScarewareFullscreen(el).scare).toBe(true);
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

  it("ignores script, style and hidden text", () => {
    const el = div(`<script>${SCARE_TEXT}</script><style>${SCARE_TEXT}</style><div hidden>${SCARE_TEXT}</div><p>Hello</p>`);
    expect(isScarewareFullscreen(el)).toEqual({ scare: false, reasons: [] });
  });

  it("reads only a bounded prefix of very long text", () => {
    const el = div(`<p>${"filler ".repeat(1000)}${SCARE_TEXT}</p>`);
    expect(isScarewareFullscreen(el).scare).toBe(false);
  });

  it("stays fast on pathological whitespace", () => {
    const el = div(`<p>your computer${" ".repeat(4000)}is${" ".repeat(4000)}locked</p>`);
    const started = Date.now();
    isScarewareFullscreen(el);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("Gym fixtures", () => {
  const load = (name: string, id: string): Element => {
    const html = readFileSync(`gym/${name}`, "utf8");
    return new DOMParser().parseFromString(html, "text/html").getElementById(id)!;
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
