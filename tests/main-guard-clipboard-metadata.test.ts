import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, it } from "vitest";

// Refactoring guard: execute the actual function and classifier. Browser APIs
// are modeled here; native-engine compatibility has its own Playwright case.
const source = readFileSync("extension/src/content/main_guard.ts", "utf8");
const ast = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, true);
const patch = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "patchClipboard");
assert.ok(patch);
const classifier = readFileSync("extension/src/content/command_keywords.ts", "utf8");
const executable = ts.transpileModule(`${classifier}\n${patch.getText(ast)}\npatchClipboard();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type Item = { types: string[]; getType(type: string): Promise<{ text(): Promise<string> }> };
function boot(nativeWrite: () => Promise<void> = () => Promise.resolve()) {
  const rows: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const clipboard = { write: (_items: Item[]) => nativeWrite(), writeText: (_text: string) => Promise.resolve() };
  vm.runInNewContext(executable, {
    exports: {}, navigator: { clipboard }, nativeClipboardWrite: clipboard.write,
    nativeClipboardWriteText: clipboard.writeText, nativeApply: Reflect.apply,
    debug: false, nowMs: () => 123,
    postToIsolated: (type: string, payload: Record<string, unknown>) => rows.push({ type, payload }),
  });
  return { clipboard, rows, snapshot: () => JSON.parse(JSON.stringify(rows)) as unknown };
}
const item = (text: string): Item => ({ types: ["text/plain"], getType: async () => ({ text: async () => text }) });
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const expected = (length: number, command: boolean) => [{
  type: "ns-clipboard-write", payload: { ts: 123, contentLength: length, looksLikeCommand: command },
}];

describe("clipboard successful-write metadata equivalence", () => {
  for (const text of ["benign fixture", "NS_INERT base64"]) {
    it(`text and ClipboardItem paths agree for ${text}`, async () => {
      const direct = boot();
      const items = boot();
      await direct.clipboard.writeText(text);
      await items.clipboard.write([item(text)]);
      await settle();
      assert.deepEqual(direct.snapshot(), expected(text.length, text.includes("base64")));
      assert.deepEqual(items.snapshot(), direct.snapshot());
      assert.equal(JSON.stringify(items.rows).includes(text), false);
    });
  }
  it("reports the non-text fallback without reading item bodies", async () => {
    const h = boot();
    await h.clipboard.write([{ types: ["image/png"], getType: async () => { throw new Error("body read"); } }]);
    await settle();
    assert.deepEqual(h.snapshot(), expected(-1, false));
  });
  it("inspects only the first text item", async () => {
    const h = boot();
    await h.clipboard.write([item("benign"), { types: ["text/plain"], getType: async () => { throw new Error("second item read"); } }]);
    await settle();
    assert.deepEqual(h.snapshot(), expected(6, false));
  });
  it("emits nothing before native settlement", async () => {
    let finish!: () => void;
    const h = boot(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = h.clipboard.write([item("benign")]);
    await settle();
    assert.equal(h.rows.length, 0);
    finish();
    await pending;
    await settle();
    assert.deepEqual(h.snapshot(), expected(6, false));
  });
  it("preserves native rejection and never inspects a failed write", async () => {
    const failure = new Error("native rejected");
    const h = boot(() => Promise.reject(failure));
    await assert.rejects(h.clipboard.write([{ types: ["text/plain"], getType: async () => { throw new Error("inspection"); } }]), (error) => error === failure);
    await settle();
    assert.equal(h.rows.length, 0);
  });
  for (const stage of ["getType", "text"]) {
    it(`retains existing silence when ${stage} inspection fails`, async () => {
      const h = boot();
      await h.clipboard.write([{ types: ["text/plain"], getType: async () => {
        if (stage === "getType") throw new Error("getType failed");
        return { text: async () => { throw new Error("text failed"); } };
      } }]);
      await settle();
      assert.equal(h.rows.length, 0);
    });
  }
});
