import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, it } from "vitest";

// Execute the shipped function and classifier, not a second implementation.
// Only the browser's WebIDL/permission sink and outbound bridge are modeled.
const guard = readFileSync("extension/src/content/main_guard.ts", "utf8");
const ast = ts.createSourceFile("main_guard.ts", guard, ts.ScriptTarget.Latest, true);
const patch = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "patchClipboard");
assert.ok(patch, "production patchClipboard declaration must exist");
const classifier = readFileSync("extension/src/content/command_keywords.ts", "utf8");
const executable = ts.transpileModule(`${classifier}\n${patch.getText(ast)}\npatchClipboard();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type Receipt = { type: string; payload: Record<string, unknown> };
type Sink = (...args: unknown[]) => Promise<void>;
function boot(sink?: Sink) {
  const calls: unknown[][] = [];
  const receipts: Receipt[] = [];
  const native: Sink = function (...args) {
    calls.push(args);
    if (sink) return sink(...args);
    try {
      if (args.length === 0) throw new TypeError("one argument required");
      // Native DOMString conversion is synchronous, with Promise rejection on
      // conversion/arity failure. Browser evidence is separate from this model.
      void `${args[0]}`;
      return Promise.resolve();
    } catch (error) { return Promise.reject(error); }
  };
  const clipboard = { writeText: native };
  const sandbox = {
    exports: {}, navigator: { clipboard }, nativeClipboardWriteText: native,
    nativeClipboardWrite: undefined, debug: false, nowMs: () => 123,
    postToIsolated: (type: string, payload: Record<string, unknown>) => receipts.push({ type, payload }),
  };
  vm.runInNewContext(executable, sandbox, { filename: "actual-clipboard-patch.js" });
  return { clipboard, calls, receipts };
}

function callWithoutSyncThrow(harness: ReturnType<typeof boot>, args: unknown[]): Promise<void> {
  let result: Promise<void> | undefined;
  assert.doesNotThrow(() => { result = Reflect.apply(harness.clipboard.writeText, undefined, args); });
  assert.equal(typeof result?.then, "function", "native API returns a Promise");
  return result!;
}

function assertReceipt(harness: ReturnType<typeof boot>, text: string, command = false) {
  assert.deepEqual(JSON.parse(JSON.stringify(harness.receipts)), [{
    type: "ns-clipboard-write", payload: { ts: 123, contentLength: text.length, looksLikeCommand: command },
  }]);
}

describe("clipboard.writeText native contract (#1024)", () => {
  const values: Array<[string, unknown, string]> = [
    ["string", "847293", "847293"], ["empty", "", ""],
    ["number", 847293, "847293"], ["null", null, "null"],
    ["explicit undefined", undefined, "undefined"], ["boolean", true, "true"],
    ["BigInt", 847293n, "847293"],
    ["URL", new URL("https://example.invalid/receipt"), "https://example.invalid/receipt"],
  ];
  for (const [label, input, text] of values) {
    it(`accepts ${label} and reports only converted-text metadata`, async () => {
      const harness = boot();
      await callWithoutSyncThrow(harness, [input]);
      assert.equal(harness.calls.length, 1);
      assert.equal(harness.calls[0]?.[0], text);
      assertReceipt(harness, text);
    });
  }

  it("converts a stateful object synchronously once with the string hint", async () => {
    const harness = boot();
    let conversions = 0;
    const value = { [Symbol.toPrimitive](hint: string) {
      assert.equal(hint, "string");
      conversions++;
      if (conversions !== 1) throw new Error("second conversion");
      return "NS_SENTINEL_DO_NOT_RUN base64";
    } };
    const result = callWithoutSyncThrow(harness, [value]);
    assert.equal(conversions, 1, "conversion happens before writeText returns");
    assert.equal(harness.receipts.length, 0);
    await result;
    assert.equal(conversions, 1);
    assert.equal(harness.calls[0]?.[0], "NS_SENTINEL_DO_NOT_RUN base64");
    assertReceipt(harness, "NS_SENTINEL_DO_NOT_RUN base64", true);
  });

  it("does not reread the original object after the native write settles", async () => {
    let finish!: () => void;
    const harness = boot(() => new Promise<void>((resolve) => { finish = resolve; }));
    let conversions = 0;
    const value = { toString: () => { conversions++; return "benign receipt"; } };
    const result = callWithoutSyncThrow(harness, [value]);
    assert.equal(conversions, 1);
    assert.equal(harness.receipts.length, 0);
    value.toString = () => { throw new Error("late coercion"); };
    finish();
    await result;
    assertReceipt(harness, "benign receipt");
  });

  it("keeps omitted arguments distinct from explicit undefined", async () => {
    const harness = boot();
    const result = callWithoutSyncThrow(harness, []);
    await assert.rejects(result, { name: "TypeError" });
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0]?.length, 0);
    assert.equal(harness.receipts.length, 0);
  });

  it("rejects Symbol conversion through a Promise without a write receipt", async () => {
    const harness = boot();
    await assert.rejects(callWithoutSyncThrow(harness, [Symbol("receipt")]), { name: "TypeError" });
    assert.equal(harness.receipts.length, 0);
  });

  it("preserves the exact thrown conversion error as the rejection", async () => {
    const harness = boot();
    const failure = new Error("conversion failed");
    let conversions = 0;
    const value = { toString() { conversions++; throw failure; } };
    await assert.rejects(callWithoutSyncThrow(harness, [value]), (error) => error === failure);
    assert.equal(conversions, 1);
    assert.equal(harness.receipts.length, 0);
  });

  it("preserves native permission rejection and failed-write silence", async () => {
    const failure = new DOMException("permission denied", "NotAllowedError");
    const harness = boot(() => Promise.reject(failure));
    await assert.rejects(callWithoutSyncThrow(harness, ["NS_SENTINEL base64"]), (error) => error === failure);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.receipts.length, 0);
  });

  it("preserves extra arguments without coercing them", async () => {
    const harness = boot();
    const extra = { toString() { throw new Error("unused argument read"); } };
    await callWithoutSyncThrow(harness, ["benign", extra]);
    assert.equal(harness.calls[0]?.length, 2);
    assert.equal(harness.calls[0]?.[1], extra);
    assertReceipt(harness, "benign");
  });

  it("retains the one-required-parameter function length", () => {
    assert.equal(boot().clipboard.writeText.length, 1);
  });
});
