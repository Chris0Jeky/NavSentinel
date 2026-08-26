// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOGGLE_IDS = [
  { id: "navDebug", labelId: "lbl-navDebug", descId: "desc-navDebug" },
  { id: "dismiss", labelId: "lbl-od", descId: "desc-od" },
  { id: "blockHttpPasswordSubmit", labelId: "lbl-blockHttp", descId: "desc-blockHttp" },
  { id: "warnOnPaste", labelId: "lbl-warnPaste", descId: "desc-warnPaste" },
  { id: "promptOnUntrustedDomain", labelId: "lbl-promptUntrusted", descId: "desc-promptUntrusted" },
  { id: "promptOnMediumRisk", labelId: "lbl-promptMedium", descId: "desc-promptMedium" },
  { id: "similarityEnabled", labelId: "lbl-similarity", descId: undefined },
];

describe("toggle switch accessibility — HTML validation", () => {
  let html: string;

  beforeAll(() => {
    html = fs.readFileSync(
      path.resolve(__dirname, "..", "extension", "src", "options", "options.html"),
      "utf8"
    );
    document.documentElement.innerHTML = html;
  });

  for (const toggle of TOGGLE_IDS) {
    it(`${toggle.id} has role="switch" and aria-labelledby`, () => {
      const btn = document.getElementById(toggle.id) as HTMLButtonElement;
      expect(btn, `button #${toggle.id} not found`).toBeTruthy();
      expect(btn.getAttribute("role")).toBe("switch");
      expect(btn.getAttribute("aria-checked")).toBe("false");
      expect(btn.getAttribute("aria-labelledby")).toBe(toggle.labelId);

      const label = document.getElementById(toggle.labelId);
      expect(label, `label #${toggle.labelId} not found`).toBeTruthy();
      expect(label!.textContent!.trim().length).toBeGreaterThan(0);
    });

    if (toggle.descId) {
      it(`${toggle.id} has aria-describedby pointing to description`, () => {
        const btn = document.getElementById(toggle.id) as HTMLButtonElement;
        expect(btn.getAttribute("aria-describedby")).toBe(toggle.descId);

        const desc = document.getElementById(toggle.descId!);
        expect(desc, `description #${toggle.descId} not found`).toBeTruthy();
        expect(desc!.textContent!.trim().length).toBeGreaterThan(0);
      });
    }
  }
});

describe("toggle switch behavior", () => {
  function createToggle(labelText: string, checked = false): { btn: HTMLButtonElement; label: HTMLDivElement } {
    const label = document.createElement("div");
    label.id = "test-label";
    label.textContent = labelText;

    const btn = document.createElement("button");
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(checked));
    btn.setAttribute("aria-labelledby", "test-label");
    btn.innerHTML = '<span class="toggle-thumb"></span>';
    btn.addEventListener("click", () => {
      const current = btn.getAttribute("aria-checked") === "true";
      btn.setAttribute("aria-checked", String(!current));
    });

    return { btn, label };
  }

  it("toggles aria-checked on click", () => {
    const { btn } = createToggle("Test toggle", false);
    expect(btn.getAttribute("aria-checked")).toBe("false");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("false");
  });

  it("starts checked when initialized as true", () => {
    const { btn } = createToggle("Test toggle", true);
    expect(btn.getAttribute("aria-checked")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-checked")).toBe("false");
  });

  it("is focusable as a native button", () => {
    const { btn } = createToggle("Test toggle");
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    document.body.removeChild(btn);
  });
});
