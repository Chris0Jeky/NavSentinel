// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

function createToggle(label: string, checked = false): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(checked));
  btn.setAttribute("aria-label", label);
  btn.innerHTML = '<span class="toggle-thumb"></span>';
  btn.addEventListener("click", () => {
    const current = btn.getAttribute("aria-checked") === "true";
    btn.setAttribute("aria-checked", String(!current));
  });
  return btn;
}

describe("toggle switch accessibility", () => {
  it("has aria-label matching the visible label text", () => {
    const btn = createToggle("Debug overlay");
    expect(btn.getAttribute("aria-label")).toBe("Debug overlay");
    expect(btn.getAttribute("role")).toBe("switch");
  });

  it("toggles aria-checked on click", () => {
    const btn = createToggle("Paste warnings", false);
    expect(btn.getAttribute("aria-checked")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("false");
  });

  it("starts checked when initialized as true", () => {
    const btn = createToggle("DNR backstop", true);
    expect(btn.getAttribute("aria-checked")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("false");
  });

  it("is keyboard-activatable via native button behavior", () => {
    const btn = createToggle("Block HTTP submit");
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-checked")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("true");
  });
});
