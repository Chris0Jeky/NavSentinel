// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { setSegValue, getSegValue, initSegKeyboard } from "../extension/src/shared/seg_control";

function createSeg(activeValue = "smart"): HTMLDivElement {
  const seg = document.createElement("div");
  seg.innerHTML = `
    <button class="seg-btn" role="radio" data-value="off" tabindex="-1" aria-checked="false">Off</button>
    <button class="seg-btn" role="radio" data-value="smart" tabindex="0" aria-checked="false">Smart</button>
    <button class="seg-btn" role="radio" data-value="strict" tabindex="-1" aria-checked="false">Strict</button>
  `;
  setSegValue(seg, activeValue);
  return seg;
}

describe("seg_control", () => {
  describe("setSegValue", () => {
    it("selects the matching button and deselects others", () => {
      const seg = createSeg("strict");
      const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
      expect(btns[0]!.getAttribute("aria-checked")).toBe("false");
      expect(btns[1]!.getAttribute("aria-checked")).toBe("false");
      expect(btns[2]!.getAttribute("aria-checked")).toBe("true");
      expect(btns[2]!.getAttribute("tabindex")).toBe("0");
      expect(btns[0]!.getAttribute("tabindex")).toBe("-1");
    });

    it("is case-insensitive", () => {
      const seg = createSeg("STRICT");
      const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
      expect(btns[2]!.getAttribute("aria-checked")).toBe("true");
    });

    it("falls back to first button when value is unrecognized", () => {
      const seg = createSeg("nonexistent");
      const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
      expect(btns[0]!.getAttribute("aria-checked")).toBe("true");
      expect(btns[0]!.getAttribute("tabindex")).toBe("0");
      expect(btns[1]!.getAttribute("aria-checked")).toBe("false");
      expect(btns[2]!.getAttribute("aria-checked")).toBe("false");
    });
  });

  describe("getSegValue", () => {
    it("returns the value of the checked button", () => {
      const seg = createSeg("strict");
      expect(getSegValue(seg)).toBe("strict");
    });

    it("returns smart when no button is checked", () => {
      const seg = document.createElement("div");
      seg.innerHTML = `
        <button class="seg-btn" role="radio" data-value="off" aria-checked="false">Off</button>
        <button class="seg-btn" role="radio" data-value="smart" aria-checked="false">Smart</button>
      `;
      expect(getSegValue(seg)).toBe("smart");
    });

    it("returns the first checked button if multiple are checked", () => {
      const seg = document.createElement("div");
      seg.innerHTML = `
        <button class="seg-btn" role="radio" data-value="off" aria-checked="true">Off</button>
        <button class="seg-btn" role="radio" data-value="smart" aria-checked="true">Smart</button>
      `;
      expect(getSegValue(seg)).toBe("off");
    });
  });

  describe("initSegKeyboard", () => {
    let seg: HTMLDivElement;
    let btns: HTMLButtonElement[];

    beforeEach(() => {
      seg = createSeg("smart");
      document.body.appendChild(seg);
      initSegKeyboard(seg);
      btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"));
    });

    it("wraps from last to first on ArrowRight", () => {
      setSegValue(seg, "strict");
      const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
      btns[2]!.dispatchEvent(event);
      expect(document.activeElement).toBe(btns[0]);
    });

    it("wraps from first to last on ArrowLeft", () => {
      setSegValue(seg, "off");
      const event = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true });
      btns[0]!.dispatchEvent(event);
      expect(document.activeElement).toBe(btns[2]);
    });

    it("moves right within the group", () => {
      const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
      btns[1]!.dispatchEvent(event);
      expect(document.activeElement).toBe(btns[2]);
    });

    it("ignores non-arrow keys", () => {
      btns[1]!.focus();
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      btns[1]!.dispatchEvent(event);
      expect(document.activeElement).toBe(btns[1]);
    });
  });
});
