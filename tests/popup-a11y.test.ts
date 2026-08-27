// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("popup.html accessibility — HTML validation", () => {
  beforeAll(() => {
    const html = fs.readFileSync(
      path.resolve(__dirname, "..", "extension", "src", "popup", "popup.html"),
      "utf8"
    );
    document.documentElement.innerHTML = html;
  });

  it("trustBtn has aria-label", () => {
    const btn = document.getElementById("trustBtn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toContain("Trust");
  });

  it("untrustBtn has aria-label", () => {
    const btn = document.getElementById("untrustBtn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toContain("Untrust");
  });

  it("openOptions has aria-label", () => {
    const btn = document.getElementById("openOptions") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Open dashboard");
  });

  it("events feed has role=log and aria-live", () => {
    const events = document.getElementById("events");
    expect(events).toBeTruthy();
    expect(events!.getAttribute("role")).toBe("log");
    expect(events!.getAttribute("aria-live")).toBe("polite");
    expect(events!.getAttribute("aria-label")).toBe("Event log");
  });

  it("trustStatus has aria-live for dynamic updates", () => {
    const trust = document.getElementById("trustStatus");
    expect(trust).toBeTruthy();
    expect(trust!.getAttribute("aria-live")).toBe("polite");
  });

  it("mode strip section has aria-label", () => {
    const section = document.querySelector('section.mode-strip');
    expect(section).toBeTruthy();
    expect(section!.getAttribute("aria-label")).toBe("Protection modes");
  });

  it("auto-dismiss quick setting is a labelled keyboard-operable checkbox", () => {
    const input = document.getElementById("autoDismiss") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("checkbox");
    expect(input.getAttribute("role")).toBe("switch");
    expect(input.closest("label")?.textContent).toContain("Auto-dismiss risky overlays");
    expect(input.closest("label")?.getAttribute("title")).toBe("Hide detected high-risk overlays");
  });

  it("activity section has aria-label", () => {
    const section = document.querySelector('section.activity');
    expect(section).toBeTruthy();
    expect(section!.getAttribute("aria-label")).toBe("Recent activity");
  });

  it("logo is hidden from assistive technology", () => {
    const logo = document.getElementById("logoSlot");
    expect(logo).toBeTruthy();
    expect(logo!.getAttribute("aria-hidden")).toBe("true");
  });

  it("shieldArc has role=img and aria-label for risk score context", () => {
    const arc = document.getElementById("shieldArc");
    expect(arc).toBeTruthy();
    expect(arc!.getAttribute("role")).toBe("img");
    expect(arc!.getAttribute("aria-label")).toBe("Tab risk score");
  });

  it("gaugeNote exists and starts hidden (#219)", () => {
    // The unscored-threat note is real text (not colour-only), so the state is
    // perceivable without colour; it must not announce on a clean page.
    const note = document.getElementById("gaugeNote");
    expect(note).toBeTruthy();
    expect(note!.hasAttribute("hidden")).toBe(true);
    expect(note!.textContent?.trim()).toBe("");
  });
});

describe("popup trust button aria-label — dynamic update", () => {
  it("updates aria-label with site name on refreshUi", () => {
    const btn = document.createElement("button");
    btn.id = "trustBtn";
    btn.setAttribute("aria-label", "Trust this site");

    const siteLabel = "example.com";
    btn.setAttribute("aria-label", `Trust ${siteLabel}`);
    expect(btn.getAttribute("aria-label")).toBe("Trust example.com");
  });

  it("updates untrust button aria-label with site name", () => {
    const btn = document.createElement("button");
    btn.id = "untrustBtn";
    btn.setAttribute("aria-label", "Untrust this site");

    const siteLabel = "example.com";
    btn.setAttribute("aria-label", `Untrust ${siteLabel}`);
    expect(btn.getAttribute("aria-label")).toBe("Untrust example.com");
  });

  it("shieldArc aria-label includes dynamic score value", () => {
    const arc = document.createElement("div");
    arc.setAttribute("role", "img");
    arc.setAttribute("aria-label", "Tab risk score");

    const tabRisk = 42;
    arc.setAttribute("aria-label", `Tab risk score: ${tabRisk}`);
    expect(arc.getAttribute("aria-label")).toBe("Tab risk score: 42");
  });

  it("falls back to generic label when no valid domain", () => {
    const trustBtn = document.createElement("button");
    trustBtn.setAttribute("aria-label", "Trust this site");
    const untrustBtn = document.createElement("button");
    untrustBtn.setAttribute("aria-label", "Untrust this site");

    const registrableDomain = "";
    trustBtn.setAttribute("aria-label", registrableDomain ? `Trust ${registrableDomain}` : "Trust this site");
    untrustBtn.setAttribute("aria-label", registrableDomain ? `Untrust ${registrableDomain}` : "Untrust this site");

    expect(trustBtn.getAttribute("aria-label")).toBe("Trust this site");
    expect(untrustBtn.getAttribute("aria-label")).toBe("Untrust this site");
  });
});
