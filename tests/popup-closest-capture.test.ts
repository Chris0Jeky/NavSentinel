// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readCapturedClosest } from "../extension/src/content/main_guard_helpers";
import {
  assertEarlyMainPrelude,
  EARLY_MAIN_CLOSEST,
  EARLY_MAIN_GET_ATTRIBUTE,
  EARLY_MAIN_PRELUDE,
  installEarlyMainClockText,
} from "../scripts/content-loader-contract.mjs";

const GENERATED = "(function(){'use strict';(async()=>{await import(chrome.runtime.getURL(\"assets/main_guard.js\"))})().catch(console.error)})();\n";

describe("readCapturedClosest (#1063)", () => {
  it("finds the real ancestor after the live closest hides anchors and invents a button", () => {
    document.body.innerHTML = `<a id="real-anchor" href="/away"><button id="real-button" type="submit"><span id="inner">Go</span></button></a>`;
    const inner = document.getElementById("inner");
    expect(inner).not.toBeNull();
    const captured = Element.prototype.closest;
    const fake = document.createElement("button");
    fake.id = "fake-button";
    Element.prototype.closest = function (selector: string) {
      return selector === "a" ? null : fake;
    };
    try {
      expect(inner!.closest("a")).toBeNull();
      expect(inner!.closest("button, input")).toBe(fake);
      expect(readCapturedClosest(inner!, "a", captured)?.id).toBe("real-anchor");
      expect(readCapturedClosest(inner!, "button, input", captured)?.id).toBe("real-button");
    } finally {
      Object.defineProperty(Element.prototype, "closest", { configurable: true, writable: true, value: captured });
      document.body.innerHTML = "";
    }
  });

  it("returns null for no match and undefined when the reader is missing, throws, or is not an element", () => {
    const lone = document.createElement("div");
    const captured = Element.prototype.closest;
    expect(readCapturedClosest(lone, "button, input", captured)).toBeNull();
    expect(readCapturedClosest(lone, "a", undefined)).toBeUndefined();
    expect(readCapturedClosest(lone, "a", () => {
      throw new Error("replaced");
    })).toBeUndefined();
    expect(readCapturedClosest(lone, "a", () => "nope" as unknown as null)).toBeUndefined();
  });
});

describe("popup intent uses the captured readers (#1063)", () => {
  const guard = readFileSync(resolve("extension/src/content/main_guard.ts"), "utf8");
  const source = ts.createSourceFile("main_guard.ts", guard, ts.ScriptTarget.Latest, true);

  function declaration(fn: string): ts.FunctionDeclaration {
    const decl = source.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === fn);
    expect(decl, fn).toBeDefined();
    return decl!;
  }

  function callsNamed(fn: string, name: string): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
        found.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration(fn));
    return found;
  }

  it("findPopupIntentSource and attrLength do not call closest or getAttribute", () => {
    const closestReads = callsNamed("findPopupIntentSource", "readCapturedClosest");
    expect(closestReads.map((call) => {
      const selector = call.arguments[1];
      return selector && ts.isStringLiteral(selector) ? selector.text : "";
    })).toEqual(["a", "button, input"]);
    for (const call of closestReads) {
      const reader = call.arguments[2];
      expect(reader && ts.isIdentifier(reader) && reader.text === "nativeClosest").toBe(true);
    }
    const typeReads = callsNamed("findPopupIntentSource", "readCapturedAttribute");
    expect(typeReads).toHaveLength(1);
    expect(typeReads[0].arguments[1] && ts.isStringLiteral(typeReads[0].arguments[1]) && typeReads[0].arguments[1].text).toBe("type");
    expect(typeReads[0].arguments[2] && ts.isIdentifier(typeReads[0].arguments[2]) && typeReads[0].arguments[2].text).toBe("nativeGetAttribute");

    const nameReads = callsNamed("attrLength", "readCapturedAttribute");
    expect(nameReads).toHaveLength(1);
    expect(nameReads[0].arguments[2] && ts.isIdentifier(nameReads[0].arguments[2]) && nameReads[0].arguments[2].text).toBe("nativeGetAttribute");

    for (const fn of ["findPopupIntentSource", "attrLength"]) {
      const text = declaration(fn).getText(source);
      expect(text).not.toContain(".closest(");
      expect(text).not.toContain(".getAttribute(");
    }
    const sourceText = declaration("findPopupIntentSource").getText(source);
    expect(sourceText).toContain("if (anchor !== null) return null;");
    expect(sourceText).toContain("if (typeAttr === undefined) return null;");
  });

  it("prefers the loader capture over the module-level method", () => {
    const init = guard.indexOf("const earlyClosest = ");
    expect(init).toBeGreaterThanOrEqual(0);
    const binding = guard.slice(init, init + 480);
    expect(binding).toContain("__navsentinelMainClosest");
    expect(binding.indexOf("__navsentinelMainClosest")).toBeLessThan(binding.indexOf("nativeElementClosest"));
  });
});

describe("document-start closest capture (#1063)", () => {
  it("installs the capture after getAttribute and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    expect(loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE)).toBeLessThan(loader.indexOf(EARLY_MAIN_CLOSEST));
    expect(loader.indexOf(EARLY_MAIN_CLOSEST)).toBeLessThan(loader.indexOf("await import("));
    expect(EARLY_MAIN_PRELUDE.indexOf(EARLY_MAIN_GET_ATTRIBUTE)).toBeLessThan(EARLY_MAIN_PRELUDE.indexOf(EARLY_MAIN_CLOSEST));
    expect(() => assertEarlyMainPrelude(loader)).not.toThrow();
  });

  it("rejects a missing, duplicated, or reordered closest capture", () => {
    const installed = installEarlyMainClockText(GENERATED);
    expect(() => assertEarlyMainPrelude(installed.replace(EARLY_MAIN_CLOSEST, ""))).toThrow(/missing early closest/);
    expect(() => assertEarlyMainPrelude(`${installed}${EARLY_MAIN_CLOSEST}`)).toThrow(/more than one early closest/);
    const swapped = installed.replace(
      `${EARLY_MAIN_GET_ATTRIBUTE}${EARLY_MAIN_CLOSEST}`,
      `${EARLY_MAIN_CLOSEST}${EARLY_MAIN_GET_ATTRIBUTE}`,
    );
    expect(() => assertEarlyMainPrelude(swapped)).toThrow(/must follow the getAttribute/);
  });

  it("keeps the platform method after Element.prototype.closest is replaced", () => {
    const context = vm.createContext({});
    vm.runInContext(
      "globalThis.Element = function Element() {};" +
        "Element.prototype.closest = function (selector) { return this.matches[selector] ?? null; };" +
        "globalThis.el = Object.assign(Object.create(Element.prototype), { matches: { a: { id: 'real-anchor' }, 'button, input': { id: 'real-button' } } });",
      context,
    );
    vm.runInContext(`(function(){'use strict';${EARLY_MAIN_PRELUDE}})();`, context);
    vm.runInContext(
      "Element.prototype.closest = function (selector) { return selector === 'a' ? null : { id: 'fake-button' }; };",
      context,
    );
    expect(vm.runInContext("el.closest('a')", context)).toBeNull();
    expect(vm.runInContext("el.closest('button, input').id", context)).toBe("fake-button");
    expect(vm.runInContext("globalThis.__navsentinelMainClosest.call(el, 'a').id", context)).toBe("real-anchor");
    expect(vm.runInContext("globalThis.__navsentinelMainClosest.call(el, 'button, input').id", context)).toBe("real-button");
  });
});
