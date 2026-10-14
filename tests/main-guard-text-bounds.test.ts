// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual private functions without installing MAIN-world patches.
const source = readFileSync(resolve("extension/src/content/main_guard.ts"), "utf8");
const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
const functions = file.statements.filter((node) => ts.isFunctionDeclaration(node) &&
  ["textLength", "attrLength", "hasMeaningfulName"].includes(node.name?.text ?? ""));
const compiled = ts.transpileModule(functions.map((node) => node.getText(file)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { textLength, hasMeaningfulName } = vm.runInNewContext(
  `${compiled}\n({ textLength, hasMeaningfulName });`, { document, Node, NodeFilter },
) as { textLength: (el: Element) => number; hasMeaningfulName: (el: Element) => boolean };

describe("MAIN-world popup text bounds (#1086)", () => {
  it.each(["", " \t\n\u00a0", "Continue", " 日 本 語 😀 ", "x".repeat(79), "x".repeat(100)])(
    "preserves short-name length and verdict for %j", (text) => {
      const el = document.createElement("button");
      el.append(document.createTextNode(text.slice(0, 2)), document.createTextNode(text.slice(2)));
      const expected = Math.min(text.replace(/\s+/g, "").length, 80);
      expect(textLength(el)).toBe(expected);
      expect(hasMeaningfulName(el)).toBe(expected > 0);
    },
  );

  it("finds a short name after a long whitespace prefix", () => {
    const el = document.createElement("a");
    el.textContent = " ".repeat(4096) + "Continue";
    expect(textLength(el)).toBe(8);
  });

  it("stops after enough text without serializing the subtree or reading its tail", () => {
    const el = document.createElement("button");
    el.append(document.createTextNode("x".repeat(80)));
    const tail = document.createTextNode("x".repeat(1_000_000));
    el.append(tail);
    Object.defineProperty(el, "textContent", { get: () => { throw new Error("subtree serialized"); } });
    Object.defineProperty(tail, "data", { get: () => { throw new Error("tail read"); } });
    Object.defineProperty(tail, "substringData", { value: () => { throw new Error("tail read"); } });
    expect(textLength(el)).toBe(80);
  });

  it("never materializes a huge text node in full", () => {
    const el = document.createElement("button");
    const big = document.createTextNode(" ".repeat(1_000_000) + "Continue");
    el.append(big);
    const sub = vi.spyOn(big, "substringData"); // a browser substringData copies only the requested range
    expect(textLength(el)).toBe(0);
    expect(sub).toHaveBeenCalledWith(0, 65536);
  });

  it("bounds scans of a huge whitespace text node", () => {
    const el = document.createElement("button");
    el.textContent = " ".repeat(1_000_000) + "Continue";
    expect(textLength(el)).toBe(0);
  });

  it("bounds visits even through empty nested elements", () => {
    const el = document.createElement("button");
    for (let i = 0; i < 5000; i++) {
      const span = document.createElement("span");
      span.append(document.createElement("span"));
      el.append(span);
    }
    const next = vi.spyOn(TreeWalker.prototype, "nextNode");
    try {
      expect(textLength(el)).toBe(0);
      expect(next.mock.calls.length).toBeGreaterThan(0);
      expect(next.mock.calls.length).toBeLessThanOrEqual(4096);
    } finally {
      next.mockRestore();
    }
  });

  it("uses an explicit name without inspecting huge hidden text", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Continue");
    el.innerHTML = '<span hidden>hidden text</span>';
    el.firstChild!.textContent = "x".repeat(1_000_000);
    const walk = vi.spyOn(document, "createTreeWalker");
    Object.defineProperty(el, "textContent", { get: () => { throw new Error("subtree serialized"); } });
    try {
      expect(hasMeaningfulName(el)).toBe(true);
      expect(walk).not.toHaveBeenCalled();
    } finally {
      walk.mockRestore();
    }
  });
});
