import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";

/**
 * #1016 regression: the opener Location proxy must stay M1 native-compatible.
 *
 * These tests execute the ACTUAL private patchOpenerLocation declaration
 * extracted with the TypeScript AST and transpiled into node:vm (same shape as
 * tests/main-guard-native-open.test.ts), using only a minimal captured
 * globals/window/native fixture. Nothing here copies the implementation and no
 * new production export/helper module was added for testability.
 *
 * The fixtures are synthetic real-like doubles, NOT branded-browser proof: a
 * mock Location with immutable own assign/replace/toString data methods that
 * enforce the native receiver and model ToString/missing-argument errors, plus
 * a cross-origin-like double whose reads throw while the href write stays
 * writable. Do not read synthetic green here as Chrome behavior; the
 * trusted-HTTP same-origin/no-extension/cross-origin gates still own that.
 */

/** Extract the actual private patchOpenerLocation declaration from main_guard.ts. */
function extractPatchOpenerLocation(source: string): string {
  const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "patchOpenerLocation") {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) {
    throw new Error("patchOpenerLocation function declaration not found in main_guard.ts");
  }
  const slice = source.slice(found.getStart(file), found.getEnd());
  if (slice.length === 0) {
    throw new Error("patchOpenerLocation source slice is empty");
  }
  return slice;
}

const SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../extension/src/content/main_guard.ts",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");
const SLICE = extractPatchOpenerLocation(SOURCE);

const COMPILED = ts.transpileModule(SLICE, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface PostedEvent {
  type: string;
  json: string;
}

interface RealLocationState {
  href: string;
  assigns: unknown[][];
  replaces: unknown[][];
  hrefSets: string[];
}

/**
 * Real-like Location double: immutable own assign/replace/toString data
 * methods (nonwritable + nonconfigurable, like Chromium's LegacyUnforgeable
 * instance members) that enforce the native receiver and model native
 * ToString (template interpolation rejects Symbol) and missing-argument
 * errors. A url containing "boom" models a native call failure AFTER the
 * observation point, so tests can pin record-then-propagate ordering.
 */
function makeRealLocation(initialHref: string): {
  loc: Record<string, unknown>;
  state: RealLocationState;
} {
  const state: RealLocationState = { href: initialHref, assigns: [], replaces: [], hrefSets: [] };
  const loc: Record<string, unknown> = {};
  const assign = function (this: unknown, ...args: unknown[]): void {
    if (this !== loc) throw new TypeError("Illegal invocation");
    if (args.length === 0) {
      throw new TypeError(
        "Failed to execute 'assign' on 'Location': 1 argument required, but only 0 present.",
      );
    }
    const coerced = `${args[0]}`;
    if (coerced.includes("boom")) throw new Error("native boom");
    state.assigns.push([...args]);
    state.href = coerced;
  };
  const replace = function (this: unknown, ...args: unknown[]): void {
    if (this !== loc) throw new TypeError("Illegal invocation");
    if (args.length === 0) {
      throw new TypeError(
        "Failed to execute 'replace' on 'Location': 1 argument required, but only 0 present.",
      );
    }
    const coerced = `${args[0]}`;
    state.replaces.push([...args]);
    state.href = coerced;
  };
  const toStringFn = function (this: unknown): string {
    if (this !== loc) throw new TypeError("Illegal invocation");
    return state.href;
  };
  Object.defineProperties(loc, {
    href: {
      get: () => state.href,
      set: (v: unknown) => {
        const coerced = `${v}`;
        state.hrefSets.push(coerced);
        state.href = coerced;
      },
      enumerable: true,
      configurable: true,
    },
    assign: { value: assign, writable: false, enumerable: false, configurable: false },
    replace: { value: replace, writable: false, enumerable: false, configurable: false },
    toString: { value: toStringFn, writable: false, enumerable: false, configurable: false },
    origin: { get: () => "https://opener.example", enumerable: true, configurable: true },
  });
  return { loc, state };
}

/** Cross-origin-like double: every read throws, but the href write stays writable. */
function makeCrossOriginLocation(log: { hrefSets: string[] }): Record<string, unknown> {
  const loc: Record<string, unknown> = {};
  const blocked = (): never => {
    throw new Error("cross-origin read blocked");
  };
  Object.defineProperties(loc, {
    href: {
      get: blocked,
      set: (v: unknown) => {
        log.hrefSets.push(`${v}`);
      },
      enumerable: true,
      configurable: true,
    },
    assign: { get: blocked, enumerable: false, configurable: false },
    replace: { get: blocked, enumerable: false, configurable: false },
    toString: { get: blocked, enumerable: false, configurable: false },
  });
  return loc;
}

type Sandbox = vm.Context & Record<string, unknown>;

/**
 * Minimal captured globals/window/native fixture for the extracted slice: the
 * slice's only free identifiers are window, nowMs, postToIsolated, debug,
 * lastOpenerNavTs and lastOpenerNavUrl (plus vm builtins). `nativeLocation`
 * exposes the same fixture object for inside-vm reflection comparisons only.
 */
function installPatch(windowOpener: unknown, nativeLocation: unknown): {
  ctx: Sandbox;
  posted: PostedEvent[];
} {
  const posted: PostedEvent[] = [];
  const sandbox: Record<string, unknown> = {
    window: { opener: windowOpener },
    nativeLocation,
    nowMs: () => 7777,
    postToIsolated: (type: string, payload?: Record<string, unknown>) => {
      posted.push({ type, json: JSON.stringify(payload ?? null) });
    },
    debug: false,
    lastOpenerNavTs: 0,
    lastOpenerNavUrl: "",
  };
  const ctx = vm.createContext(sandbox) as Sandbox;
  vm.runInContext(`${COMPILED}\n;patchOpenerLocation();`, ctx);
  return { ctx, posted };
}

function freshSameOrigin(): {
  ctx: Sandbox;
  posted: PostedEvent[];
  realOpener: Record<string, unknown>;
  state: RealLocationState;
} {
  const { loc, state } = makeRealLocation("https://opener.example/home");
  const realOpener: Record<string, unknown> = { location: loc, closed: false };
  const { ctx, posted } = installPatch(realOpener, loc);
  return { ctx, posted, realOpener, state };
}

function ev(ctx: Sandbox, expr: string): unknown {
  return vm.runInContext(expr, ctx);
}

/** Runs a statement inside vm and returns a "Name|message" tag, or "no-throw". */
function evError(ctx: Sandbox, stmt: string): string {
  return vm.runInContext(
    `(() => { try { ${stmt} } catch (e) { const n = e?.constructor?.name ?? typeof e; return n + "|" + (e?.message ?? ""); } return "no-throw"; })()`,
    ctx,
  ) as string;
}

function openerNavEvents(posted: PostedEvent[]): Array<{ url: string; ts: number }> {
  return posted
    .filter((e) => e.type === "ns-dblclick-opener-nav")
    .map((e) => JSON.parse(e.json) as { url: string; ts: number });
}

describe("main_guard patchOpenerLocation extraction (#1016)", () => {
  it("extracts the actual private declaration with no production imports", () => {
    expect(SLICE).toContain("patchOpenerLocation");
    expect(SLICE).not.toMatch(/^import\s/m);
    expect(SLICE).toContain("recordOpenerNav");
    expect(SLICE).toContain("createLocationProxy");
  });

});

describe("same-origin opener.location writes (#1016)", () => {
  it("href write returns, navigates and records exactly once", () => {
    const { ctx, posted, state } = freshSameOrigin();
    ev(ctx, `window.opener.location.href = "https://evil.example/phish";`);
    expect(state.href).toBe("https://evil.example/phish");
    expect(state.hrefSets).toEqual(["https://evil.example/phish"]);
    expect(openerNavEvents(posted)).toEqual([{ url: "https://evil.example/phish", ts: 7777 }]);
    expect(ctx["lastOpenerNavTs"] as number).toBe(7777);
    expect(ctx["lastOpenerNavUrl"] as string).toBe("https://evil.example/phish");
  });

  it("assign dispatches natively exactly once with the same observed string", () => {
    const { ctx, posted, state } = freshSameOrigin();
    ev(ctx, `var probe = { n: 0, toString() { this.n += 1; return "https://evil.example/a"; } };`);
    ev(ctx, `window.opener.location.assign(probe, "extra");`);
    expect(ev(ctx, "probe.n")).toBe(1);
    expect(state.assigns).toEqual([["https://evil.example/a", "extra"]]);
    expect(state.href).toBe("https://evil.example/a");
    expect(openerNavEvents(posted)).toEqual([{ url: "https://evil.example/a", ts: 7777 }]);
  });

  it("replace dispatches natively exactly once and records the same string", () => {
    const { ctx, posted, state } = freshSameOrigin();
    ev(ctx, `window.opener.location.replace("https://evil.example/r");`);
    expect(state.replaces).toEqual([["https://evil.example/r"]]);
    expect(state.href).toBe("https://evil.example/r");
    expect(openerNavEvents(posted)).toEqual([{ url: "https://evil.example/r", ts: 7777 }]);
  });

  it("method identity is stable and the location stringifies through the native", () => {
    const { ctx } = freshSameOrigin();
    expect(ev(ctx, "window.opener.location.assign === window.opener.location.assign")).toBe(true);
    expect(ev(ctx, "window.opener.location.replace === window.opener.location.replace")).toBe(true);
    expect(ev(ctx, "window.opener.location.toString === window.opener.location.toString")).toBe(true);
    expect(ev(ctx, "window.opener.location.assign !== window.opener.location.replace")).toBe(true);
    expect(ev(ctx, "window.opener.location === window.opener.location")).toBe(true);
    expect(ev(ctx, "window.opener.location.toString()")).toBe("https://opener.example/home");
    expect(ev(ctx, "String(window.opener.location)")).toBe("https://opener.example/home");
    // Bound to the native receiver: rebinding the wrapper cannot steal it.
    expect(ev(ctx, "window.opener.location.toString.call({})")).toBe("https://opener.example/home");
  });

  it("descriptor method values agree with the cached get wrappers", () => {
    const { ctx } = freshSameOrigin();
    expect(
      ev(
        ctx,
        `(d => d.configurable === true && d.writable === false && d.value === window.opener.location.assign)(Object.getOwnPropertyDescriptor(window.opener.location, "assign"))`,
      ),
    ).toBe(true);
  });

  it("reflected href setter preserves single coercion and observation", () => {
    const { ctx, posted, state } = freshSameOrigin();
    ev(ctx, `var url = { n: 0, toString() { this.n++; return "https://opener.example/reflected"; } };`);
    ev(ctx, `Object.getOwnPropertyDescriptor(window.opener.location, "href").set.call({}, url);`);
    expect(ev(ctx, "url.n")).toBe(1);
    expect(state.hrefSets).toEqual(["https://opener.example/reflected"]);
    expect(openerNavEvents(posted)).toEqual([{ url: "https://opener.example/reflected", ts: 7777 }]);
  });

  it("href and direct location writes coerce a stateful object exactly once", () => {
    const { ctx, posted, realOpener, state } = freshSameOrigin();
    ev(ctx, `var h = { n: 0, toString() { this.n += 1; return "https://evil.example/h"; } };`);
    ev(ctx, `window.opener.location.href = h;`);
    expect(ev(ctx, "h.n")).toBe(1);
    expect(state.hrefSets).toEqual(["https://evil.example/h"]);
    ev(ctx, `var d = { n: 0, toString() { this.n += 1; return "https://evil.example/d"; } };`);
    ev(ctx, `window.opener.location = d;`);
    expect(ev(ctx, "d.n")).toBe(1);
    expect(openerNavEvents(posted).map((e) => e.url)).toEqual([
      "https://evil.example/h",
      "https://evil.example/d",
    ]);
    // The direct write forwards the same coerced string with the native receiver.
    expect(realOpener["location"]).toBe("https://evil.example/d");
  });

  it("omitted arguments are not recorded and let the native throw", () => {
    const { ctx, posted } = freshSameOrigin();
    expect(evError(ctx, "window.opener.location.assign()")).toContain("1 argument required");
    expect(evError(ctx, "window.opener.location.replace()")).toContain("1 argument required");
    expect(openerNavEvents(posted)).toEqual([]);
  });

  it("Symbol arguments propagate without recording", () => {
    const { ctx, posted } = freshSameOrigin();
    expect(evError(ctx, "window.opener.location.assign(Symbol('x'))")).toContain("TypeError");
    expect(evError(ctx, "window.opener.location.replace(Symbol('x'))")).toContain("TypeError");
    expect(evError(ctx, `window.opener.location.href = Symbol("x")`)).toContain("TypeError");
    expect(evError(ctx, `window.opener.location = Symbol("x")`)).toContain("TypeError");
    expect(openerNavEvents(posted)).toEqual([]);
  });

  it("native call errors propagate after the observation is recorded", () => {
    const { ctx, posted, state } = freshSameOrigin();
    expect(evError(ctx, `window.opener.location.assign("https://evil.example/boom")`)).toContain(
      "native boom",
    );
    expect(openerNavEvents(posted)).toEqual([
      { url: "https://evil.example/boom", ts: 7777 },
    ]);
    expect(state.assigns).toEqual([]);
  });

  it("preserves other opener behavior and the explicit disown-to-null rule", () => {
    const { ctx } = freshSameOrigin();
    expect(ev(ctx, "window.opener.closed")).toBe(false);
    ev(ctx, `window.opener.custom = 7;`);
    expect(ev(ctx, "window.opener.custom")).toBe(7);
    // A foreign replacement is ignored; the proxy stays in place.
    ev(ctx, `window.opener = { evil: 1 };`);
    expect(ev(ctx, `typeof window.opener.location.assign`)).toBe("function");
    // Disowning to null (security hardening) keeps working.
    ev(ctx, `window.opener = null;`);
    expect(ev(ctx, "window.opener")).toBe(null);
  });

  it("no opener is a benign no-op", () => {
    const { ctx, posted } = installPatch(null, null);
    expect(ev(ctx, "window.opener")).toBe(null);
    expect(posted).toEqual([]);
  });
});

describe("facade reflection and locking (#1016)", () => {
  it("forwards keys, membership and prototype lazily", () => {
    const { loc } = makeRealLocation("https://opener.example/home");
    const realOpener: Record<string, unknown> = { location: loc, closed: false };
    const { ctx } = installPatch(realOpener, loc);
    expect(ev(ctx, "JSON.stringify(Reflect.ownKeys(window.opener.location))")).toBe(
      JSON.stringify(Reflect.ownKeys(loc)),
    );
    expect(ev(ctx, `"assign" in window.opener.location`)).toBe(true);
    expect(ev(ctx, `"nope" in window.opener.location`)).toBe(false);
    expect(ev(ctx, "Object.getPrototypeOf(window.opener.location) === Object.getPrototypeOf(nativeLocation)")).toBe(
      true,
    );
    expect(
      ev(
        ctx,
        `(d => d.configurable === true && typeof d.get === "function" && typeof d.set === "function")(Object.getOwnPropertyDescriptor(window.opener.location, "href"))`,
      ),
    ).toBe(true);
  });

  it("installs nothing nonconfigurable on the facade", () => {
    const { ctx } = freshSameOrigin();
    expect(
      ev(
        ctx,
        `Reflect.ownKeys(window.opener.location).every(k => Object.getOwnPropertyDescriptor(window.opener.location, k).configurable === true)`,
      ),
    ).toBe(true);
  });

  it("refuses facade locking and nonconfigurable definitions", () => {
    const { ctx } = freshSameOrigin();
    expect(evError(ctx, "Object.preventExtensions(window.opener.location)")).not.toBe("no-throw");
    expect(ev(ctx, "Object.isExtensible(window.opener.location)")).toBe(true);
    expect(evError(ctx, "Object.setPrototypeOf(window.opener.location, {})")).not.toBe("no-throw");
    expect(evError(ctx, `Object.defineProperty(window.opener.location, "x", { value: 1 })`)).not.toBe(
      "no-throw",
    );
    expect(
      evError(
        ctx,
        `Object.defineProperty(window.opener.location, "x", { value: 1, configurable: false })`,
      ),
    ).not.toBe("no-throw");
  });

  it("forwards configurable definitions and deletions to the native Location", () => {
    const { loc } = makeRealLocation("https://opener.example/home");
    const realOpener: Record<string, unknown> = { location: loc, closed: false };
    const { ctx } = installPatch(realOpener, loc);
    ev(
      ctx,
      `Object.defineProperty(window.opener.location, "extra", { value: 42, writable: true, enumerable: true, configurable: true });`,
    );
    expect(loc["extra"]).toBe(42);
    expect(ev(ctx, "delete window.opener.location.extra")).toBe(true);
    expect("extra" in loc).toBe(false);
  });
});

describe("cross-origin-like reads must not erase the writable href path (#1016)", () => {
  it("records and forwards href writes while read errors propagate", () => {
    const hrefSets: string[] = [];
    const crossLoc = makeCrossOriginLocation({ hrefSets });
    const { ctx, posted } = installPatch({ location: crossLoc, closed: false }, crossLoc);
    ev(ctx, `window.opener.location.href = "https://evil.example/cross";`);
    expect(hrefSets).toEqual(["https://evil.example/cross"]);
    expect(openerNavEvents(posted)).toEqual([{ url: "https://evil.example/cross", ts: 7777 }]);
    // Method-valued reads throw through the shared helper instead of returning undefined.
    expect(evError(ctx, "window.opener.location.assign")).toContain("cross-origin read blocked");
    expect(evError(ctx, "String(window.opener.location)")).toContain("cross-origin read blocked");
    // The failed reads recorded nothing extra.
    expect(openerNavEvents(posted)).toHaveLength(1);
  });
});
