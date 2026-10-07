import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  assertEarlyMainClock,
  assertEarlyMainPrelude,
  EARLY_MAIN_BASE_URI,
  EARLY_MAIN_CLOCK,
  EARLY_MAIN_FORM_TARGET,
  EARLY_MAIN_GET_ATTRIBUTE,
  EARLY_MAIN_PRELUDE,
  installEarlyMainClockText,
} from "../scripts/content-loader-contract.mjs";

// The shape CRXJS emits for the MAIN-world guard loader.
const GENERATED = "(function(){'use strict';(async()=>{await import(chrome.runtime.getURL(\"assets/main_guard.js\"))})().catch(console.error)})();\n";

// A realm with a DOM-like Node whose baseURI getter reads the node's own base,
// so a test can tell the platform getter from a page replacement.
function realmWithNode(): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(
    "globalThis.Node = function Node() {};" +
      "Object.defineProperty(Node.prototype, 'baseURI', { configurable: true, get() { return this.realBase; } });" +
      "globalThis.doc = Object.assign(Object.create(Node.prototype), { realBase: 'http://127.0.0.2:9/' });",
    context,
  );
  return context;
}

const loaderPrefix = `(function(){'use strict';${EARLY_MAIN_PRELUDE}})();`;

describe("MAIN-world early baseURI capture (#900)", () => {
  it("installs the whole prelude, clock first, directly after 'use strict' and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    const prelude = loader.indexOf(EARLY_MAIN_PRELUDE);
    expect(prelude).toBeGreaterThan(loader.indexOf("'use strict';"));
    expect(loader.indexOf(EARLY_MAIN_BASE_URI)).toBeLessThan(loader.indexOf("await import("));
    expect(loader.indexOf(EARLY_MAIN_CLOCK)).toBe(prelude);
    expect(() => assertEarlyMainPrelude(loader)).not.toThrow();
    expect(() => assertEarlyMainClock(loader)).not.toThrow();
  });

  it("rejects a loader whose baseURI capture is missing, duplicated, out of order, or after the import", () => {
    const installed = installEarlyMainClockText(GENERATED);
    expect(() => assertEarlyMainPrelude(installed.replace(EARLY_MAIN_BASE_URI, ""))).toThrow(/missing early baseURI capture/);
    expect(() => assertEarlyMainPrelude(`${installed}${EARLY_MAIN_BASE_URI}`)).toThrow(/more than one early baseURI/);
    // Separated from the clock capture: the prelude block no longer follows 'use strict' intact.
    expect(() => assertEarlyMainPrelude(installed.replace(
      EARLY_MAIN_PRELUDE,
      `${EARLY_MAIN_CLOCK}void 0;${EARLY_MAIN_BASE_URI}${EARLY_MAIN_FORM_TARGET}${EARLY_MAIN_GET_ATTRIBUTE}`,
    ))).toThrow(/directly follow/);
    const moved = GENERATED.replace("'use strict';", `'use strict';\n  ${EARLY_MAIN_CLOCK}`).replace(
      "await import(",
      `await import(${JSON.stringify("")}) ,${EARLY_MAIN_BASE_URI}await import(`,
    );
    expect(() => assertEarlyMainPrelude(moved)).toThrow();
  });

  it("keeps the platform getter when the page replaces Node.prototype.baseURI afterwards", () => {
    const context = realmWithNode();
    vm.runInContext(loaderPrefix, context);
    vm.runInContext(
      "Object.defineProperty(Node.prototype, 'baseURI', { configurable: true, get() { return 'http://localhost:1/'; } })",
      context,
    );
    expect(vm.runInContext("doc.baseURI", context)).toBe("http://localhost:1/");
    expect(vm.runInContext("globalThis.__navsentinelMainBaseURI.call(doc)", context)).toBe("http://127.0.0.2:9/");
    const descriptor = vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainBaseURI')", context);
    expect(descriptor).toMatchObject({ writable: false, configurable: false });
  });

  it("keeps the first capture when the loader is evaluated again after tampering", () => {
    const context = realmWithNode();
    vm.runInContext(loaderPrefix, context);
    const first = vm.runInContext("globalThis.__navsentinelMainBaseURI", context);
    vm.runInContext(
      "Object.defineProperty(Node.prototype, 'baseURI', { configurable: true, get() { return 'http://localhost:1/'; } })",
      context,
    );
    expect(() => vm.runInContext(loaderPrefix, context)).not.toThrow();
    expect(vm.runInContext("globalThis.__navsentinelMainBaseURI", context)).toBe(first);
  });

  it("stores nothing, and does not throw, when there is no Node or no getter", () => {
    const bare = vm.createContext({});
    expect(() => vm.runInContext(loaderPrefix, bare)).not.toThrow();
    expect(vm.runInContext("'__navsentinelMainBaseURI' in globalThis", bare)).toBe(false);
    // The clock capture before it still ran.
    expect(vm.runInContext("typeof globalThis.__navsentinelMainDateNow", bare)).toBe("function");

    const valueOnly = vm.createContext({});
    vm.runInContext("globalThis.Node = function Node() {}; Node.prototype.baseURI = 'http://localhost:1/';", valueOnly);
    expect(() => vm.runInContext(loaderPrefix, valueOnly)).not.toThrow();
    expect(vm.runInContext("'__navsentinelMainBaseURI' in globalThis", valueOnly)).toBe(false);
  });
});

function realmWithForm(): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(
    "globalThis.HTMLFormElement = function HTMLFormElement() {};" +
      "Object.defineProperty(HTMLFormElement.prototype, 'target', { configurable: true, get() { return this.realTarget; } });" +
      "globalThis.form = Object.assign(Object.create(HTMLFormElement.prototype), { realTarget: '_top' });",
    context,
  );
  return context;
}

describe("MAIN-world early form target capture (#1055)", () => {
  it("installs the capture after baseURI and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    expect(loader.indexOf(EARLY_MAIN_BASE_URI)).toBeLessThan(loader.indexOf(EARLY_MAIN_FORM_TARGET));
    expect(loader.indexOf(EARLY_MAIN_FORM_TARGET)).toBeLessThan(loader.indexOf("await import("));
    expect(() => assertEarlyMainPrelude(loader)).not.toThrow();
  });

  it("rejects a missing, duplicated, or reordered form target capture", () => {
    const installed = installEarlyMainClockText(GENERATED);
    expect(() => assertEarlyMainPrelude(installed.replace(EARLY_MAIN_FORM_TARGET, ""))).toThrow(/missing early form target/);
    expect(() => assertEarlyMainPrelude(`${installed}${EARLY_MAIN_FORM_TARGET}`)).toThrow(/more than one early form target/);
    const swapped = installed.replace(
      `${EARLY_MAIN_BASE_URI}${EARLY_MAIN_FORM_TARGET}`,
      `${EARLY_MAIN_FORM_TARGET}${EARLY_MAIN_BASE_URI}`,
    );
    expect(() => assertEarlyMainPrelude(swapped)).toThrow(/must follow the baseURI/);
  });

  it("keeps the platform getter when the page replaces HTMLFormElement.prototype.target afterwards", () => {
    const context = realmWithForm();
    vm.runInContext(loaderPrefix, context);
    vm.runInContext(
      "Object.defineProperty(HTMLFormElement.prototype, 'target', { configurable: true, get() { return ''; } })",
      context,
    );
    expect(vm.runInContext("form.target", context)).toBe("");
    expect(vm.runInContext("globalThis.__navsentinelMainFormTarget.call(form)", context)).toBe("_top");
    const descriptor = vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainFormTarget')", context);
    expect(descriptor).toMatchObject({ writable: false, configurable: false });
  });

  it("keeps the first capture when the loader is evaluated again after tampering", () => {
    const context = realmWithForm();
    vm.runInContext(loaderPrefix, context);
    const first = vm.runInContext("globalThis.__navsentinelMainFormTarget", context);
    vm.runInContext(
      "Object.defineProperty(HTMLFormElement.prototype, 'target', { configurable: true, get() { return ''; } })",
      context,
    );
    expect(() => vm.runInContext(loaderPrefix, context)).not.toThrow();
    expect(vm.runInContext("globalThis.__navsentinelMainFormTarget", context)).toBe(first);
  });

  it("stores nothing, and does not throw, when there is no HTMLFormElement or no getter", () => {
    const bare = vm.createContext({});
    expect(() => vm.runInContext(loaderPrefix, bare)).not.toThrow();
    expect(vm.runInContext("'__navsentinelMainFormTarget' in globalThis", bare)).toBe(false);

    const valueOnly = vm.createContext({});
    vm.runInContext(
      "globalThis.HTMLFormElement = function HTMLFormElement() {}; HTMLFormElement.prototype.target = '_top';",
      valueOnly,
    );
    expect(() => vm.runInContext(loaderPrefix, valueOnly)).not.toThrow();
    expect(vm.runInContext("'__navsentinelMainFormTarget' in globalThis", valueOnly)).toBe(false);
  });
});
