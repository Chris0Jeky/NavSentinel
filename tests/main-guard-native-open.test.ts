import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";

type OpenFn = (thisArg: unknown, url?: unknown, target?: unknown, features?: unknown) => unknown;

/** Extract the actual private callNativeOpen declaration from main_guard.ts. */
function extractCallNativeOpen(source: string): string {
  const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "callNativeOpen") {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) {
    throw new Error("callNativeOpen function declaration not found in main_guard.ts");
  }
  const slice = source.slice(found.getStart(file), found.getEnd());
  if (slice.length === 0) {
    throw new Error("callNativeOpen source slice is empty");
  }
  return slice;
}

const SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../extension/src/content/main_guard.ts",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");
const SLICE = extractCallNativeOpen(SOURCE);

const COMPILED = ts.transpileModule(SLICE, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

/** Instantiate the actual function with only the two captured native globals. */
function loadActualOpen(protoValue: unknown, instanceValue: unknown): OpenFn {
  const sandbox = vm.createContext({
    nativeProtoOpen: protoValue,
    nativeOpen: instanceValue,
  });
  const result: unknown = vm.runInContext(`${COMPILED}\ncallNativeOpen;`, sandbox);
  if (typeof result !== "function") {
    throw new Error("transpiled callNativeOpen did not evaluate to a function");
  }
  return result as OpenFn;
}

interface NativeCall {
  receiver: unknown;
  args: unknown[];
}

function makeNativeSpy(returnValue: unknown): { fn: (...args: never[]) => unknown; calls: NativeCall[] } {
  const calls: NativeCall[] = [];
  const fn = function (this: unknown, ...args: never[]): unknown {
    calls.push({ receiver: this, args: [...args] });
    return returnValue;
  };
  return { fn: fn as (...args: never[]) => unknown, calls };
}

describe("main_guard callNativeOpen (#1007)", () => {
  it("is a narrow slice with no production imports", () => {
    expect(SLICE).toContain("callNativeOpen");
    expect(SLICE).not.toMatch(/^import\s/m);
    expect(SLICE).toContain("nativeProtoOpen");
    expect(SLICE).toContain("nativeOpen");
  });

  it("falls back to the instance native for undefined and truthy non-functions", () => {
    const fallbacks: unknown[] = [undefined, { name: "open" }, "open", 42];
    for (const protoValue of fallbacks) {
      const popup = { name: "popup" };
      const receiver = { name: "receiver" };
      const { fn, calls } = makeNativeSpy(popup);
      const open = loadActualOpen(protoValue, fn);
      const returned = open(receiver, "https://example.com/", "_blank", "popup");
      expect(returned).toBe(popup);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.receiver).toBe(receiver);
      expect(calls[0]?.args).toEqual(["https://example.com/", "_blank", "popup"]);
    }
  });

  it("prefers a callable prototype and preserves receiver, optionals and return", () => {
    const protoPopup = { name: "proto-popup" };
    const instancePopup = { name: "instance-popup" };
    const proto = makeNativeSpy(protoPopup);
    const instance = makeNativeSpy(instancePopup);
    const open = loadActualOpen(proto.fn, instance.fn);
    const receiver = { name: "receiver" };
    const returned = open(receiver, "https://example.com/", "_blank", "popup");
    expect(returned).toBe(protoPopup);
    expect(proto.calls).toHaveLength(1);
    expect(instance.calls).toHaveLength(0);
    expect(proto.calls[0]?.receiver).toBe(receiver);
    expect(proto.calls[0]?.args).toEqual(["https://example.com/", "_blank", "popup"]);

    const omitted = makeNativeSpy(protoPopup);
    const openOmitted = loadActualOpen(undefined, omitted.fn);
    const returnedOmitted = openOmitted(receiver, undefined, undefined, undefined);
    expect(returnedOmitted).toBe(protoPopup);
    expect(omitted.calls).toHaveLength(1);
    expect(omitted.calls[0]?.receiver).toBe(receiver);
    expect(omitted.calls[0]?.args).toEqual([undefined, undefined, undefined]);
  });
});
