import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";

const GRANT = "https://a.example/grant";
const RACE = "https://b.example/race";

const SOURCE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../extension/src/content/main_guard.ts",
);
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

/** Slice the actual private function declaration out of main_guard.ts. */
function extractFunction(source: string, name: string): string {
  const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) {
    throw new Error(`${name} function declaration not found in main_guard.ts`);
  }
  const slice = source.slice(found.getStart(file), found.getEnd());
  if (slice.length === 0) {
    throw new Error(`${name} source slice is empty`);
  }
  return slice;
}

function extractConstNumber(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  if (!match) {
    throw new Error(`${name} const not found in main_guard.ts`);
  }
  return Number(match[1]);
}

type OpenAllowance = "allow_once" | "allowed" | "none";

interface AllowanceHarness {
  setAllowOnce: (url?: string) => void;
  consumeOpenAllowance: (url?: string | URL) => OpenAllowance;
}

/**
 * Instantiate the real setAllowOnce/consumeOpenAllowance pair with shared
 * module-equivalent state and a frozen clock. The URL binding under test
 * lives in the extracted consumeOpenAllowance source, not in this file.
 */
function loadHarness(): AllowanceHarness {
  const setSlice = extractFunction(SOURCE, "setAllowOnce");
  const consumeSlice = extractFunction(SOURCE, "consumeOpenAllowance");
  const ttl = extractConstNumber(SOURCE, "ALLOW_ONCE_TTL_MS");
  const maxOpens = extractConstNumber(SOURCE, "MAX_OPENS_PER_GESTURE");
  const holder = { now: 1_000_000 };
  const sandbox = vm.createContext({
    nowMs: (): number => holder.now,
  });
  const combined = [
    "let openCount = 0;",
    "let allowOnceRemaining = 0;",
    "let allowOnceUntil = 0;",
    'let allowOnceUrl = "";',
    "let allowOpenUntil = 0;",
    `const ALLOW_ONCE_TTL_MS = ${ttl};`,
    `const MAX_OPENS_PER_GESTURE = ${maxOpens};`,
    setSlice,
    consumeSlice,
    "globalThis.__nsAllowanceHarness = { setAllowOnce, consumeOpenAllowance };",
  ].join("\n");
  const compiled = ts.transpileModule(combined, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(compiled, sandbox);
  const harness = (sandbox as unknown as { __nsAllowanceHarness: AllowanceHarness })
    .__nsAllowanceHarness;
  if (!harness || typeof harness.setAllowOnce !== "function") {
    throw new Error("allowance harness did not evaluate");
  }
  return harness;
}

describe("main_guard allow-once URL binding", () => {
  it("binds an allow-once grant to the exact authorized URL", () => {
    // A racing open for another URL must neither consume nor burn the grant:
    // removing the String(url) === allowOnceUrl gate makes the first consume
    // return "allow_once", and burning on mismatch makes the second return
    // "none". Either regression fails this test.
    const harness = loadHarness();
    harness.setAllowOnce(GRANT);
    expect(harness.consumeOpenAllowance(RACE)).toBe("none");
    expect(harness.consumeOpenAllowance(GRANT)).toBe("allow_once");
  });
});
