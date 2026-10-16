import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

type Method = "pushState" | "replaceState";
type HistoryFn = (this: unknown, ...args: unknown[]) => unknown;
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  "../extension/src/content/main_guard.ts"), "utf8");
const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
const declarations = file.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "patchHistory");
const declaration = declarations[0];
if (declarations.length !== 1 || !declaration) throw new Error("Expected exactly one actual patchHistory declaration");
const compiled = ts.transpileModule(declaration.getText(file), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

/** Executes the production declaration; the native and observer dependencies are modeled. */
function install(options: { reason?: string; debug?: boolean; nativeError?: Error } = {}) {
  class ModelHistory {}
  const history = new ModelHistory();
  const calls: { method: Method; receiver: unknown; args: unknown[] }[] = [];
  const observations: { method: Method; url: unknown }[] = [];
  const posts: { type: string; payload: Record<string, unknown> }[] = [];
  const logs: unknown[][] = [];
  const order: string[] = [];
  const requiredError = new TypeError("native requires two arguments");
  const receiverError = new TypeError("native requires a History receiver");
  const returned = { nativeReturn: true };
  const native = (method: Method): HistoryFn => function (this: unknown, ...args: unknown[]) {
    calls.push({ method, receiver: this, args });
    order.push(`native:${method}`);
    if (this !== history) throw receiverError;
    if (args.length < 2) throw requiredError;
    if (options.nativeError) throw options.nativeError;
    return returned;
  };
  const sandbox = vm.createContext({
    History: ModelHistory,
    nativePushState: native("pushState"),
    nativeReplaceState: native("replaceState"),
    softPatchProto: (proto: object, method: string, fn: HistoryFn, tag: string) => {
      if (tag !== `History.prototype.${method}`) throw new Error("Unexpected patch tag");
      Object.defineProperty(proto, method, { value: fn, writable: true, configurable: true, enumerable: true });
    },
    checkPushStateSuspicious: (url: unknown, method: Method) => {
      order.push(`observe:${method}`);
      observations.push({ method, url });
      return options.reason ?? null;
    },
    postToIsolated: (type: string, payload: Record<string, unknown>) => {
      order.push("post");
      posts.push({ type, payload });
    },
    nowMs: () => 456,
    debug: options.debug ?? false,
    console: { debug: (...args: unknown[]) => logs.push(args) },
  });
  vm.runInContext(`${compiled}\npatchHistory();`, sandbox);
  const methods = ModelHistory.prototype as unknown as Record<Method, HistoryFn>;
  return { history, methods, calls, observations, posts, logs, order, requiredError, receiverError, returned };
}

describe.each<Method>(["pushState", "replaceState"])("actual MAIN History %s (#1022/#891)", (method) => {
  it.each([0, 1])("preserves a native required-argument error with %i supplied arguments", (count) => {
    const h = install({ reason: "suspicious", debug: true });
    const args = count === 0 ? [] : [{ retained: true }];
    let caught: unknown;
    try { Reflect.apply(h.methods[method], h.history, args); }
    catch (error) { caught = error; }
    expect(caught).toBe(h.requiredError);
    expect(h.calls).toHaveLength(1);
    for (const call of h.calls) {
      expect(call.receiver).toBe(h.history);
      expect(call.args).toEqual(args);
    }
    expect(h.observations).toEqual([]);
    expect(h.posts).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it("keeps an omitted optional URL omitted and returns the native result", () => {
    const h = install();
    const state = { retained: true };
    expect(Reflect.apply(h.methods[method], h.history, [state, "unused"])).toBe(h.returned);
    expect(h.calls[0]?.args).toEqual([state, "unused"]);
    expect(h.calls[0]?.args[0]).toBe(state);
    expect(h.observations).toEqual([{ method, url: undefined }]);
    expect(h.posts).toEqual([]);
  });

  it("coerces a URL once and shares that string with the native, observer and post", () => {
    const h = install({ reason: "history-loop", debug: true });
    const state = { retained: true };
    const extra = { ignoredByNative: true };
    let coercions = 0;
    const url = { toString() { coercions++; return coercions === 1 ? "/first" : "/different"; } };
    expect(Reflect.apply(h.methods[method], h.history, [state, "unused", url, extra])).toBe(h.returned);
    expect(coercions).toBe(1);
    expect(h.calls[0]?.args).toEqual([state, "unused", "/first", extra]);
    expect(h.calls[0]?.args[0]).toBe(state);
    expect(h.calls[0]?.args[3]).toBe(extra);
    expect(h.observations).toEqual([{ method, url: "/first" }]);
    expect(h.posts).toEqual([{ type: "ns-pushstate-suspicious", payload: {
      ts: 456, url: "/first", method, reason: "history-loop",
    } }]);
    expect(h.logs).toEqual([[`[NavSentinel] suspicious ${method}`, { url: "/first", reason: "history-loop" }]]);
    expect(h.order).toEqual([`native:${method}`, `observe:${method}`, "post"]);
  });

  it.each([null, undefined])("preserves an explicitly supplied %s URL", (url) => {
    const h = install({ reason: "history-loop" });
    Reflect.apply(h.methods[method], h.history, [null, "", url]);
    expect(h.calls[0]?.args).toEqual([null, "", url]);
    expect(h.observations).toEqual([{ method, url }]);
    expect(h.posts[0]?.payload.url).toBe("");
  });

  it("rejects a Symbol URL without native calls or observations", () => {
    const h = install({ reason: "suspicious" });
    expect(() => Reflect.apply(h.methods[method], h.history, [null, "", Symbol("url")])).toThrow(/Symbol/);
    expect(h.calls).toEqual([]);
    expect(h.observations).toEqual([]);
    expect(h.posts).toEqual([]);
  });

  it("propagates native failures without an observation or post", () => {
    const nativeError = new Error("native state serialization failed");
    const h = install({ reason: "suspicious", nativeError });
    let caught: unknown;
    try { Reflect.apply(h.methods[method], h.history, [{}, "", "/benign"]); }
    catch (error) { caught = error; }
    expect(caught).toBe(nativeError);
    expect(h.calls).toHaveLength(1);
    expect(h.observations).toEqual([]);
    expect(h.posts).toEqual([]);
  });

  it("forwards a bad receiver to the captured native", () => {
    const h = install({ reason: "suspicious" });
    const receiver = {};
    let caught: unknown;
    try { Reflect.apply(h.methods[method], receiver, [null, "", "/benign"]); }
    catch (error) { caught = error; }
    expect(caught).toBe(h.receiverError);
    expect(h.calls[0]?.receiver).toBe(receiver);
    expect(h.observations).toEqual([]);
    expect(h.posts).toEqual([]);
  });

  it("keeps benign valid calls quiet even with debug enabled", () => {
    const h = install({ debug: true });
    Reflect.apply(h.methods[method], h.history, [null, "", "/benign"]);
    expect(h.observations).toEqual([{ method, url: "/benign" }]);
    expect(h.posts).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it("installs a two-parameter wrappable function through softPatchProto", () => {
    const h = install();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(h.history), method);
    expect(descriptor).toMatchObject({ writable: true, configurable: true, enumerable: true });
    expect(h.methods[method].length).toBe(2);
  });
});
