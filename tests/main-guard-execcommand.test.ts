import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, it } from "vitest";

// Execute the shipped execCommand wrapper (#1166). happy-dom has no execCommand,
// and other suites polyfill it on the instance, which would shadow the wrapper.
const source = readFileSync("extension/src/content/main_guard.ts", "utf8");
const ast = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
const capture = ast.statements.find((node) => ts.isVariableStatement(node)
  && node.getText(ast).includes("const nativeExecCommand ="));
const wrapper = ast.statements.find((node) => ts.isTryStatement(node)
  && node.getText(ast).includes("Document.prototype.execCommand ="));
assert.ok(capture && wrapper, "production execCommand capture and wrapper must exist");
const classifier = readFileSync("extension/src/content/command_keywords.ts", "utf8");
const executable = ts.transpileModule(`${classifier}\n${capture.getText(ast)}\n${wrapper.getText(ast)}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function boot(selection: string) {
  const receivers: unknown[] = [];
  const arity: number[] = [];
  const receipts: Array<Record<string, unknown>> = [];
  class Document {
    // The wrapper reads the receiving document's selection (#1180 review).
    getSelection() { return { toString: () => (this === document ? selection : "other-document") }; }
    execCommand(this: unknown, ...args: unknown[]): boolean {
      receivers.push(this);
      arity.push(args.length);
      return args[0] === "copy" || args[0] === "CUT";
    }
  }
  const document = new Document();
  vm.runInNewContext(executable, {
    exports: {}, Document, document, nativeApply: Reflect.apply, debug: false, nowMs: () => 1,
    isOff: () => false, window: { getSelection: () => ({ toString: () => "window-selection" }) },
    postToIsolated: (type: string, payload: Record<string, unknown>) => receipts.push({ type, ...payload }),
  });
  return { Document, document, receivers, arity, receipts };
}

describe("execCommand copy receipt (#1166)", () => {
  it("wraps Document.prototype, so a direct prototype call still yields a receipt", () => {
    const h = boot("NS_INERT base64");
    assert.equal(Object.hasOwn(h.document, "execCommand"), false);
    assert.equal(Reflect.apply(h.Document.prototype.execCommand, h.document, ["copy"]), true);
    assert.deepEqual(h.receipts, [{ type: "ns-clipboard-write", ts: 1, contentLength: 15, looksLikeCommand: true }]);
  });

  it("reports cut, and converts a command object once so it cannot say copy only to the browser", () => {
    const h = boot("NS_INERT base64");
    assert.equal(h.document.execCommand("CUT"), true);
    let conversions = 0;
    const stateful = { toString: () => (conversions++ === 0 ? "copy" : "bold") };
    // The native sees the once-converted string, not the object.
    assert.equal(h.document.execCommand(stateful as unknown as string), true);
    assert.equal(conversions, 1);
    assert.deepEqual(h.receipts.map((r) => r.looksLikeCommand), [true, true]);
  });

  it("keeps native arity: an omitted command reaches the native as omitted", () => {
    const h = boot("x");
    Reflect.apply(h.Document.prototype.execCommand, h.document, []);
    assert.deepEqual(h.arity, [0]);
    assert.equal(h.receipts.length, 0);
  });

  it("classifies the receiving document's selection, not the top window's", () => {
    const h = boot("NS_INERT base64");
    assert.equal(new h.Document().execCommand("copy"), true);
    assert.deepEqual(h.receipts, [{ type: "ns-clipboard-write", ts: 1, contentLength: 14, looksLikeCommand: false }]);
  });

  it("forwards the caller's receiver and reports nothing for other commands or failures", () => {
    const h = boot("benign");
    const other = new h.Document();
    assert.equal(other.execCommand("bold"), false);
    assert.equal(h.receivers[0], other);
    assert.equal(h.receipts.length, 0);
  });
});
