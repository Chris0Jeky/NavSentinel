// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readCapturedAttribute } from "../extension/src/content/main_guard_helpers";
import {
  assertEarlyMainPrelude,
  EARLY_MAIN_FORM_TARGET,
  EARLY_MAIN_GET_ATTRIBUTE,
  EARLY_MAIN_PRELUDE,
  installEarlyMainClockText,
} from "../scripts/content-loader-contract.mjs";

const GENERATED = "(function(){'use strict';(async()=>{await import(chrome.runtime.getURL(\"assets/main_guard.js\"))})().catch(console.error)})();\n";

describe("readCapturedAttribute (#1061)", () => {
  it("reads the content attribute after the live getAttribute is replaced", () => {
    const form = document.createElement("form");
    form.setAttribute("action", "https://collector.example/take");
    const captured = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function () {
      return null;
    };
    try {
      expect(form.getAttribute("action")).toBeNull();
      expect(readCapturedAttribute(form, "action", captured)).toBe("https://collector.example/take");
    } finally {
      Object.defineProperty(Element.prototype, "getAttribute", { configurable: true, writable: true, value: captured });
    }
  });

  it("returns null for a missing attribute and undefined when the reader is missing or throws", () => {
    const form = document.createElement("form");
    const captured = Element.prototype.getAttribute;
    expect(readCapturedAttribute(form, "action", captured)).toBeNull();
    expect(readCapturedAttribute(form, "action", undefined)).toBeUndefined();
    expect(readCapturedAttribute(form, "action", () => {
      throw new Error("replaced");
    })).toBeUndefined();
    expect(readCapturedAttribute(form, "action", () => 1 as unknown as null)).toBeUndefined();
  });
});

describe("form action and method use the captured reader (#1061)", () => {
  const guard = readFileSync(resolve("extension/src/content/main_guard.ts"), "utf8");
  const source = ts.createSourceFile("main_guard.ts", guard, ts.ScriptTarget.Latest, true);

  function callsNamed(fn: string, name: string): ts.CallExpression[] {
    const decl = source.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === fn);
    expect(decl, fn).toBeDefined();
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
        found.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(decl!);
    return found;
  }

  it("resolveFormAction and isGetForm call readCapturedAttribute and not getAttribute", () => {
    for (const fn of ["resolveFormAction", "isGetForm"]) {
      const reads = callsNamed(fn, "readCapturedAttribute");
      expect(reads.length).toBeGreaterThan(0);
      for (const call of reads) {
        const reader = call.arguments[2];
        expect(reader && ts.isIdentifier(reader) && reader.text === "nativeGetAttribute").toBe(true);
      }
      expect(callsNamed(fn, "getAttribute")).toHaveLength(0);
      const decl = source.statements.find((node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === fn);
      const text = decl!.getText(source);
      expect(text).not.toContain(".getAttribute(");
    }
  });

  it("prefers the loader capture over the module-level descriptor", () => {
    const init = guard.indexOf("const earlyGetAttribute = ");
    const resolveAt = guard.indexOf("function resolveFormAction(");
    expect(init).toBeGreaterThanOrEqual(0);
    expect(init).toBeLessThan(resolveAt);
    const binding = guard.slice(init, init + 420);
    expect(binding).toContain("__navsentinelMainGetAttribute");
    expect(binding.indexOf("__navsentinelMainGetAttribute")).toBeLessThan(binding.indexOf("nativeElementGetAttribute"));
  });
});

describe("document-start getAttribute capture (#1061)", () => {
  it("installs the capture after the form-target capture and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    expect(loader.indexOf(EARLY_MAIN_FORM_TARGET)).toBeLessThan(loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE));
    expect(loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE)).toBeLessThan(loader.indexOf("await import("));
    expect(EARLY_MAIN_PRELUDE.endsWith(EARLY_MAIN_GET_ATTRIBUTE)).toBe(true);
    expect(() => assertEarlyMainPrelude(loader)).not.toThrow();
  });

  it("keeps the platform method after Element.prototype.getAttribute is replaced", () => {
    const context = vm.createContext({});
    vm.runInContext(
      "globalThis.Element = function Element() {};" +
        "Element.prototype.getAttribute = function (name) { return this.attrs[name] ?? null; };" +
        "globalThis.el = Object.assign(Object.create(Element.prototype), { attrs: { action: 'https://collector.example/take' } });",
      context,
    );
    vm.runInContext(`(function(){'use strict';${EARLY_MAIN_PRELUDE}})();`, context);
    vm.runInContext("Element.prototype.getAttribute = function () { return null; };", context);
    expect(vm.runInContext("el.getAttribute('action')", context)).toBeNull();
    expect(vm.runInContext("globalThis.__navsentinelMainGetAttribute.call(el, 'action')", context)).toBe(
      "https://collector.example/take",
    );
  });
});
