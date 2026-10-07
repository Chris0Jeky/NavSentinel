import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { it } from "vitest";
import * as loader from "../scripts/content-loader-contract.mjs";

// Run the actual helper module after the actual early prelude in a separate
// realm. Its small DOM model isolates invocation dispatch; native DOM behavior
// is checked separately by the browser spec. No global Vitest intrinsics change.
const helperSource = readFileSync("extension/src/content/main_guard_helpers.ts", "utf8");
const helperModule = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const setup = `
  class Element {
    constructor(attributes = {}, ancestor = null) { this.attributes = attributes; this.ancestor = ancestor; }
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
    closest(selector) { return selector === 'a' ? this.ancestor : null; }
  }
  class HTMLFormElement extends Element { get target() { return this.attributes.target ?? ''; } }
  globalThis.Element = Element;
  globalThis.HTMLFormElement = HTMLFormElement;
  globalThis.form = new HTMLFormElement({target: '_top', action: 'https://receiver.example/post', method: 'post'});
  globalThis.anchor = new Element();
  globalThis.button = new Element({}, anchor);
  globalThis.exports = {};
`;
const readers = [
  { name: "target", capture: "__navsentinelMainFormTarget", expression: "exports.readCapturedFormTarget(form, globalThis.__navsentinelMainFormTarget)", expected: "_top" },
  { name: "action", capture: "__navsentinelMainGetAttribute", expression: "exports.readCapturedAttribute(form, 'action', globalThis.__navsentinelMainGetAttribute)", expected: "https://receiver.example/post" },
  { name: "method", capture: "__navsentinelMainGetAttribute", expression: "exports.readCapturedAttribute(form, 'method', globalThis.__navsentinelMainGetAttribute)", expected: "post" },
  { name: "ancestor", capture: "__navsentinelMainClosest", expression: "exports.readCapturedClosest(button, 'a', globalThis.__navsentinelMainClosest) === anchor", expected: true },
] as const;
const mutations = ["own call", "prototype call", "Reflect.apply", "all dispatch methods"] as const;

function realm(): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(setup, context);
  vm.runInContext(loader.EARLY_MAIN_PRELUDE, context);
  return context;
}
function mutate(context: vm.Context, capture: string, mutation: typeof mutations[number]): void {
  const code = mutation === "own call" ? `globalThis.${capture}.call = () => null;` :
    mutation === "prototype call" ? "Function.prototype.call = () => null;" :
      mutation === "Reflect.apply" ? "Reflect.apply = () => null;" :
        `globalThis.${capture}.call = () => null;
         Function.prototype.call = Function.prototype.apply = Function.prototype.bind = () => null;
         Reflect.apply = () => null;`;
  vm.runInContext(code, context);
}

for (const reader of readers) {
  it(`preserves the ordinary ${reader.name} result`, () => {
    const context = realm();
    vm.runInContext(helperModule, context);
    assert.equal(vm.runInContext(reader.expression, context), reader.expected);
  });
  for (const phase of ["before module", "after module"] as const) {
    for (const mutation of mutations) {
      it(`keeps ${reader.name} after ${mutation} mutation ${phase}`, () => {
        const context = realm();
        if (phase === "before module") mutate(context, reader.capture, mutation);
        vm.runInContext(helperModule, context);
        if (phase === "after module") mutate(context, reader.capture, mutation);
        assert.equal(vm.runInContext(reader.expression, context), reader.expected);
      });
    }
  }
}

for (const [name, expression, expected] of [
  ["empty target", "form.attributes.target = ''; exports.readCapturedFormTarget(form, __navsentinelMainFormTarget)", ""],
  ["absent attribute", "exports.readCapturedAttribute(form, 'missing', __navsentinelMainGetAttribute)", null],
  ["empty attribute", "form.attributes.action = ''; exports.readCapturedAttribute(form, 'action', __navsentinelMainGetAttribute)", ""],
  ["unmatched ancestor", "exports.readCapturedClosest(button, 'form', __navsentinelMainClosest)", null],
  ["missing target reader", "exports.readCapturedFormTarget(form, undefined)", null],
  ["throwing target reader", "exports.readCapturedFormTarget(form, () => { throw Error('native'); })", null],
  ["non-string target", "exports.readCapturedFormTarget(form, () => 12)", null],
  ["missing attribute reader", "exports.readCapturedAttribute(form, 'action', undefined)", undefined],
  ["throwing attribute reader", "exports.readCapturedAttribute(form, 'action', () => { throw Error('native'); })", undefined],
  ["non-string attribute", "exports.readCapturedAttribute(form, 'action', () => 12)", undefined],
  ["missing closest reader", "exports.readCapturedClosest(button, 'a', undefined)", undefined],
  ["throwing closest reader", "exports.readCapturedClosest(button, 'a', () => { throw Error('native'); })", undefined],
  ["non-element ancestor", "exports.readCapturedClosest(button, 'a', () => ({}))", undefined],
] as const) {
  it(`retains the distinct ${name} result`, () => {
    const context = realm();
    vm.runInContext(helperModule, context);
    assert.equal(vm.runInContext(expression, context), expected);
  });
}

it("pins the first apply primitive without freezing or replacing page intrinsics", () => {
  const context = realm();
  assert.equal(vm.runInContext("typeof __navsentinelMainApply", context), "function");
  assert.equal(vm.runInContext("__navsentinelMainApply === Reflect.apply", context), true);
  assert.equal(vm.runInContext("Object.isFrozen(Reflect.apply)", context), false);
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainApply').writable", context), false);
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainApply').configurable", context), false);
  vm.runInContext("globalThis.firstApply = __navsentinelMainApply; Reflect.apply = () => null; firstApply.call = () => null;", context);
  vm.runInContext(loader.EARLY_MAIN_PRELUDE, context);
  vm.runInContext(helperModule, context);
  assert.equal(vm.runInContext("__navsentinelMainApply === firstApply", context), true);
  assert.equal(vm.runInContext(readers[0].expression, context), "_top");
});

it("captures invocation even in a realm without DOM constructors", () => {
  const context = vm.createContext({});
  vm.runInContext(loader.EARLY_MAIN_PRELUDE, context);
  assert.equal(vm.runInContext("typeof __navsentinelMainApply", context), "function");
});

it("uses a module-time fallback only when the early invoker is absent", () => {
  const context = vm.createContext({});
  vm.runInContext(setup, context);
  vm.runInContext("globalThis.targetGetter = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'target').get;", context);
  vm.runInContext(helperModule, context);
  vm.runInContext("targetGetter.call = () => ''; Reflect.apply = () => null;", context);
  assert.equal(vm.runInContext("exports.readCapturedFormTarget(form, targetGetter)", context), "_top");
});

it("checks that invocation capture is present, unique and inside the pre-import block", () => {
  const apply = loader.EARLY_MAIN_APPLY;
  assert.equal(typeof apply, "string");
  const generated = "(function(){'use strict';(async()=>{await import('guard.js')})()})();";
  const installed = loader.installEarlyMainClockText(generated);
  loader.assertEarlyMainPrelude(installed);
  assert.ok(installed.indexOf(apply) < installed.indexOf("await import("));
  assert.throws(() => loader.assertEarlyMainPrelude(installed.replace(apply, "")));
  assert.throws(() => loader.assertEarlyMainPrelude(installed + apply));
  assert.throws(() => loader.assertEarlyMainPrelude(installed.replace(apply, "") + apply));
});
