import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// Execute the real private helper in a child process so a pre-fix unhandled
// rejection is observable without leaking it into Vitest's own process. The
// existing popup-save-rejection suite separately checks the handler wiring.
const probe = String.raw`const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require(process.argv[1]);
const source = ts.createSourceFile('popup.ts', fs.readFileSync(process.argv[2], 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resyncAfterFailedSave');
assert(declaration, 'production recovery helper must exist');
const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const unhandled = [], warnings = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));
let refreshes = 0;
const scenario = process.argv[3];
const refreshUi = async () => { refreshes++; if (scenario === 'failure' || (scenario === 'retry' && refreshes === 1)) throw new Error('storage offline'); };
const resync = new Function('refreshUi', 'console', js + '; return resyncAfterFailedSave;')(refreshUi, { warn: (...args) => warnings.push(args) });
(async () => {
  resync('nav mode', new Error('save failed'));
  await new Promise(setImmediate);
  if (scenario === 'retry') { resync('nav mode', new Error('save failed')); await new Promise(setImmediate); }
  assert.deepEqual(unhandled, [], 'recovery must consume its own refresh rejection');
  assert.equal(refreshes, scenario === 'retry' ? 2 : 1);
  assert.equal(warnings.length, scenario === 'success' ? 1 : scenario === 'retry' ? 3 : 2);
  console.log(JSON.stringify({scenario, refreshes, warnings: warnings.length, unhandled:unhandled.length}));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

describe("popup failed-save recovery contains refresh failures (#849)", () => {
  it.each(["success", "failure", "retry"])("settles the %s recovery path", (scenario) => {
    const result = spawnSync(process.execPath, ["-e", probe,
      require.resolve("typescript"), resolve("extension/src/popup/popup.ts"), scenario], {
      encoding: "utf8", timeout: 15_000,
    });
    expect(result.status, `${result.error ?? ""}\n${result.stderr}\n${result.stdout}`).toBe(0);
  }, 20_000);
});
