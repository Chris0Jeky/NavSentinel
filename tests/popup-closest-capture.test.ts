// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as helpers from "../extension/src/content/main_guard_helpers";

// Execute the production decision functions without installing MAIN patches.
const guard = readFileSync("extension/src/content/main_guard.ts", "utf8");
const source = ts.createSourceFile("main_guard.ts", guard, ts.ScriptTarget.Latest, true);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) &&
  ["findPopupIntentSource", "attrLength"].includes(node.name?.text ?? ""));
const compiled = ts.transpileModule(functions.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function decisions(overrides: Record<string, unknown> = {}) {
  return vm.runInNewContext(`${compiled}\n({ findPopupIntentSource, attrLength });`, {
    ...helpers, Node, Element,
    nativeClosest: Function.prototype.call.bind(Element.prototype.closest),
    nativeGetAttribute: Function.prototype.call.bind(Element.prototype.getAttribute),
    ...overrides,
  }) as {
    findPopupIntentSource(target: EventTarget | null): Element | null;
    attrLength(element: Element, name: string): number;
  };
}

describe("popup-intent captured readers (#1063)", () => {
  it("does not invent popup intent when live closest hides the real anchor", () => {
    const anchor = document.createElement("a");
    const inner = document.createElement("span");
    anchor.append(inner);
    const fake = document.createElement("button");
    const decision = decisions();
    const original = Element.prototype.closest;
    Element.prototype.closest = (selector: string) => selector === "a" ? null : fake;
    try {
      expect(inner.closest("a")).toBeNull();
      expect(inner.closest("button, input")).toBe(fake);
      expect(decision.findPopupIntentSource(inner)).toBeNull();
    } finally {
      Element.prototype.closest = original;
    }
  });

  it("keeps a real input type and name when live attribute reads are replaced", () => {
    const input = document.createElement("input");
    input.setAttribute("type", "SUBMIT");
    input.setAttribute("aria-label", "Continue");
    const decision = decisions();
    const original = Element.prototype.getAttribute;
    Element.prototype.getAttribute = () => null;
    try {
      expect(input.getAttribute("type")).toBeNull();
      expect(decision.findPopupIntentSource(input)).toBe(input);
      expect(decision.attrLength(input, "aria-label")).toBe(8);
    } finally {
      Element.prototype.getAttribute = original;
    }
  });

  it("preserves ordinary button, input, empty target, and name-limit decisions", () => {
    const decision = decisions();
    const button = document.createElement("button");
    const child = document.createElement("span");
    button.append(child);
    const input = document.createElement("input");
    input.setAttribute("type", "button");
    expect(decision.findPopupIntentSource(child)).toBe(button);
    expect(decision.findPopupIntentSource(input)).toBe(input);
    input.setAttribute("type", "text");
    expect(decision.findPopupIntentSource(input)).toBeNull();
    expect(decision.findPopupIntentSource(null)).toBeNull();
    expect(decision.findPopupIntentSource(document.createTextNode("Go"))).toBeNull();
    expect(decision.attrLength(button, "aria-label")).toBe(0);
    button.setAttribute("aria-label", "x".repeat(90));
    expect(decision.attrLength(button, "aria-label")).toBe(80);
  });

  it.each([
    ["missing", undefined],
    ["undefined", () => undefined],
    ["non-element", () => ({})],
    ["throwing", () => { throw new Error("unreadable"); }],
  ])("does not arm when the closest reader is %s", (_name, nativeClosest) => {
    const button = document.createElement("button");
    expect(decisions({ nativeClosest }).findPopupIntentSource(button)).toBeNull();
  });

  it("does not arm an input or invent a name when attribute reads are unavailable", () => {
    const input = document.createElement("input");
    input.setAttribute("type", "submit");
    input.setAttribute("aria-label", "Continue");
    const decision = decisions({ nativeGetAttribute: undefined });
    expect(decision.findPopupIntentSource(input)).toBeNull();
    expect(decision.attrLength(input, "aria-label")).toBe(0);
  });

  it("has no live closest or getAttribute calls in either production decision", () => {
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.getText(source)).not.toContain(".closest(");
      expect(fn.getText(source)).not.toContain(".getAttribute(");
    }
  });
});
