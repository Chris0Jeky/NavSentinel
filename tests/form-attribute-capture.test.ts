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
  EARLY_MAIN_CLOSEST,
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
      expect(readCapturedAttribute(form, "action", Function.prototype.call.bind(captured))).toBe("https://collector.example/take");
    } finally {
      Object.defineProperty(Element.prototype, "getAttribute", { configurable: true, writable: true, value: captured });
    }
  });

  it("returns null for a missing attribute and undefined when the reader is missing or throws", () => {
    const form = document.createElement("form");
    const captured = Function.prototype.call.bind(Element.prototype.getAttribute);
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

  it("fails closed without a loader capture, including for action resolution and the GET exemption", () => {
    const init = guard.indexOf("const earlyGetAttribute = ");
    const resolveAt = guard.indexOf("function resolveFormAction(");
    expect(init).toBeGreaterThanOrEqual(0);
    expect(init).toBeLessThan(resolveAt);
    const bindingStatements = source.statements.filter((node) => ts.isVariableStatement(node)
      && node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
        && ["earlyGetAttribute", "nativeGetAttribute"].includes(declaration.name.text)));
    expect(bindingStatements).toHaveLength(2);
    const binding = bindingStatements.map((node) => node.getText(source)).join("\n");
    expect(binding).toContain("__navsentinelMainGetAttribute");
    const functions = ["resolveFormAction", "isGetForm"].map((name) => source.statements.find(
      (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name,
    )!.getText(source)).join("\n");
    const context = vm.createContext({ readCapturedAttribute });
    vm.runInContext(ts.transpile(binding + "\n" + functions), context);
    expect(vm.runInContext("nativeGetAttribute", context)).toBeUndefined();
    expect(vm.runInContext("resolveFormAction({})", context)).toBeUndefined();
    expect(vm.runInContext("isGetForm({})", context)).toBe(false);
  });
});

describe("document-start getAttribute capture (#1061)", () => {
  it.each(["own", "prototype"])("reads action and method after %s call tampering", (tamper) => {
    const context = vm.createContext({});
    vm.runInContext(
      "globalThis.Element = function Element() {};" +
        "Element.prototype.getAttribute = function (name) { return this.attrs[name] ?? null; };" +
        "globalThis.el = Object.assign(Object.create(Element.prototype), { attrs: { action: 'https://collector.example/take', method: 'post' } });",
      context,
    );
    vm.runInContext(`(function(){'use strict';${EARLY_MAIN_PRELUDE}})();`, context);
    vm.runInContext(tamper === "own"
      ? "globalThis.__navsentinelMainGetAttribute.call = () => 'get';"
      : "Function.prototype.call = () => 'get';", context);
    const element = vm.runInContext("el", context) as Element;
    const invoker = vm.runInContext("globalThis.__navsentinelMainGetAttribute", context);
    expect(readCapturedAttribute(element, "action", invoker)).toBe("https://collector.example/take");
    expect(readCapturedAttribute(element, "method", invoker)).toBe("post");
  });

  it("installs the capture after the form-target capture and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    expect(loader.indexOf(EARLY_MAIN_FORM_TARGET)).toBeLessThan(loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE));
    expect(loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE)).toBeLessThan(loader.indexOf("await import("));
    expect(EARLY_MAIN_PRELUDE).toContain(`${EARLY_MAIN_GET_ATTRIBUTE}${EARLY_MAIN_CLOSEST}`);
    expect(EARLY_MAIN_GET_ATTRIBUTE).toContain("value:Function.prototype.call.bind(getAttribute),writable:false,configurable:false");
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
    expect(vm.runInContext("globalThis.__navsentinelMainGetAttribute(el, 'action')", context)).toBe(
      "https://collector.example/take",
    );
  });
});
