import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  assertEarlyMainClock,
  EARLY_MAIN_CLOCK,
  installEarlyMainClockText,
} from "../scripts/content-loader-contract.mjs";

// The shape CRXJS emits for the MAIN-world guard loader.
const GENERATED = "(function(){'use strict';(async()=>{await import(chrome.runtime.getURL(\"assets/main_guard.js\"))})().catch(console.error)})();\n";

describe("MAIN-world early clock capture (#877, #942)", () => {
  it("installs the capture directly after 'use strict' and before the async import", () => {
    const loader = installEarlyMainClockText(GENERATED);
    const capture = loader.indexOf(EARLY_MAIN_CLOCK);
    expect(capture).toBeGreaterThan(loader.indexOf("'use strict';"));
    expect(capture).toBeLessThan(loader.indexOf("await import("));
    expect(() => assertEarlyMainClock(loader)).not.toThrow();
  });

  it("refuses a loader whose shape changed", () => {
    expect(() => installEarlyMainClockText(GENERATED.replace("'use strict';", ""))).toThrow(/shape changed/);
    expect(() => installEarlyMainClockText(GENERATED.replace("await import(", "import("))).toThrow(/shape changed/);
    expect(() => installEarlyMainClockText(`'use strict';${GENERATED}`)).toThrow(/shape changed/);
  });

  it("rejects a capture that is missing, duplicated, detached from 'use strict', or after the import", () => {
    expect(() => assertEarlyMainClock(GENERATED)).toThrow(/missing early clock capture/);
    const installed = installEarlyMainClockText(GENERATED);
    expect(() => assertEarlyMainClock(installed.replace(EARLY_MAIN_CLOCK, `${EARLY_MAIN_CLOCK}${EARLY_MAIN_CLOCK}`))).toThrow(/more than one/);
    expect(() => assertEarlyMainClock(installed.replace(EARLY_MAIN_CLOCK, `void 0;${EARLY_MAIN_CLOCK}`))).toThrow(/directly follow/);
    // A future emitter that moves the import ahead of the capture must fail the build.
    const importFirst = `(function(){'use strict';${EARLY_MAIN_CLOCK}})();(async()=>{})();`.replace("'use strict';", "'use strict';");
    const moved = `(async()=>{await import("x")})();${importFirst}`;
    expect(() => assertEarlyMainClock(moved)).toThrow();
  });

  it("does not throw when the loader is evaluated twice in the same realm, and keeps the first clock", () => {
    // The loader runs the capture inside its IIFE, so each evaluation has its
    // own function scope; only the global property is shared.
    const loaderPrefix = `(function(){'use strict';${EARLY_MAIN_CLOCK}})();`;
    const context = vm.createContext({ Date });
    vm.runInContext(loaderPrefix, context);
    const first = vm.runInContext("globalThis.__navsentinelMainDateNow", context);
    expect(() => vm.runInContext(loaderPrefix, context)).not.toThrow();
    expect(vm.runInContext("globalThis.__navsentinelMainDateNow", context)).toBe(first);
    const descriptor = vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainDateNow')", context);
    expect(descriptor).toMatchObject({ writable: false, configurable: false });
  });

  it("contrast: the unguarded capture it replaced throws on a second evaluation", () => {
    const unguarded = "(function(){'use strict';const earlyNow=Date.now.bind(Date);Object.defineProperty(globalThis,'__navsentinelMainDateNow',{value:earlyNow,writable:false,configurable:false});})();";
    const context = vm.createContext({ Date });
    vm.runInContext(unguarded, context);
    expect(() => vm.runInContext(unguarded, context)).toThrow(/redefine/);
  });
});
