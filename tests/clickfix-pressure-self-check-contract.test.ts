import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fixture = fs.readFileSync(
  path.join(root, "gym", "clickfix-06-clipboard-pressure.html"),
  "utf8",
);
const acceptance = fs.readFileSync(
  path.join(root, "tests", "acceptance", "ai47-8-clipboard-pressure.spec.ts"),
  "utf8",
);

async function runFixture(evidence: unknown, writeAt = 105, markerAt = 125) {
  const code = fixture.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  if (!code) throw new Error("Expected the actual pressure fixture script");
  let now = 0;
  let ready = false;
  const dataset: Record<string, string> = {};
  const tasks: Array<() => void> = [];
  const observers: Array<{ connected: boolean; callback: () => void }> = [];
  const root = { dataset, getAttribute: () => ready ? "1" : null };
  const elements = new Map<string, { className: string; textContent: string }>();
  class Clipboard { writeText() { return Promise.resolve(); } }
  class MutationObserver {
    private readonly entry;
    constructor(callback: (records: unknown[], observer: MutationObserver) => void) {
      this.entry = { connected: false, callback: () => callback([], this) };
      observers.push(this.entry);
    }
    observe() { this.entry.connected = true; }
    disconnect() { this.entry.connected = false; }
  }
  class MessageChannel {
    port1 = { onmessage: () => undefined as unknown };
    port2 = { postMessage: () => tasks.push(() => { this.port1.onmessage(); }) };
  }
  const window = { isSecureContext: true, __navsentinelClipboardQueueTestEvidence: evidence };
  vm.runInNewContext(code, {
    window, Clipboard, MutationObserver, MessageChannel, URLSearchParams,
    location: { search: "?mode=benign" },
    performance: { now: () => now },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    document: {
      documentElement: root,
      addEventListener: () => undefined,
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, { className: "", textContent: "" });
        return elements.get(id);
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  now = writeAt;
  tasks.shift()?.();
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  now = markerAt;
  ready = true;
  for (const observer of [...observers]) if (observer.connected) observer.callback();
  return dataset;
}

function witness(enqueued: number) {
  return {
    schema: "navsentinel-clipboard-queue-test/v2",
    artifactId: "test-artifact",
    verificationCount: 1,
    queuedAfterVerification: 0,
    firstVerification: { clipboardEnqueueCalls: enqueued, commandLike: 0, other: enqueued },
  };
}

describe("actual fixture rejects the verification-to-marker race (#963)", () => {
  it("rejects writes after actual verification even when the public marker trails by 20 ms", async () => {
    const check = await runFixture(witness(0));
    expect(check.pressureReadyGapMs).toBe("20");
    expect(check.pressureState).toBe("retry");
  });

  it("requires direct evidence even when every write predates the public marker", async () => {
    expect((await runFixture(undefined)).pressureState).toBe("retry");
  });

  it("accepts a complete pre-verification queue witness", async () => {
    expect((await runFixture(witness(40))).pressureState).toBe("valid");
  });

  it("uses the direct witness independently of any arbitrary marker-gap cutoff", async () => {
    expect((await runFixture(witness(40), 105, 105.5)).pressureState).toBe("valid");
    expect((await runFixture(witness(0), 105, 1105)).pressureState).toBe("retry");
  });

  it("rejects incomplete, mismatched, and later-handshake witnesses", async () => {
    for (const evidence of [
      witness(39), { ...witness(40), verificationCount: 2 },
      { ...witness(40), queuedAfterVerification: 1 },
      { ...witness(40), firstVerification: { clipboardEnqueueCalls: 40, commandLike: 1, other: 39 } },
      { ...witness(40), schema: "unrecognized" },
    ]) expect((await runFixture(evidence)).pressureState).toBe("retry");
  });
});

describe("acceptance reads the direct observer independently of fixture presentation", () => {
  it("rejects a forged DOM witness when the actual observer counted no queue entries", async () => {
    const file = ts.createSourceFile("acceptance.ts", acceptance, ts.ScriptTarget.Latest, true);
    const declaration = file.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "readSelfCheck");
    if (!declaration) throw new Error("Expected the actual acceptance self-check reader");
    const compiled = ts.transpileModule(declaration.getText(file), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const direct = witness(0);
    const window = Object.defineProperty({}, "__navsentinelClipboardQueueTestEvidence", {
      get: () => direct, configurable: false,
    });
    const context = vm.createContext({ window, document: { documentElement: { dataset: {
      pressureState: "valid", pressureQueueEvidence: JSON.stringify(witness(40)),
    } } } });
    vm.runInContext(compiled, context);
    const check = await vm.runInContext("readSelfCheck({ evaluate: (fn) => fn() })", context) as { queueEvidence: unknown };
    expect(check.queueEvidence).toBe(direct);
  });
});

describe("ClickFix clipboard-pressure self-check hardening (#954)", () => {
  it("keeps timing measurements diagnostic and requires direct queue observation", () => {
    expect(fixture).toContain("firstResolvedAt");
    expect(fixture).toContain("burstSpreadMs");
    expect(fixture).toContain("readyGapMs");
    expect(fixture).toContain("data.pressureBurstSpreadMs");
    expect(fixture).toContain("data.pressureReadyGapMs");
    expect(fixture).not.toContain("MIN_READY_GAP_MS");
    expect(fixture).toContain("diagnostic only");
    expect(fixture).toContain("data.pressureQueueEvidence");
  });

  it("retains ten diagnostic timing samples without using them as queue proof", () => {
    const samples = Number(
      acceptance.match(/const PRESSURE_TIMING_SAMPLES = (\d+);/u)?.[1],
    );
    expect(samples).toBeGreaterThanOrEqual(10);
    expect(acceptance).toContain("clipboard-pressure timing sample");
    expect(acceptance).toContain("readyGapMs");
    expect(acceptance).toContain("burstSpreadMs");
  });

  it("gives every load its own label before the baseline and counts ClickFix rows by label (#954)", () => {
    const start = acceptance.indexOf("async function loadValidPressureArm(");
    const end = acceptance.indexOf("\ntest(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const loader = acceptance.slice(start, end);

    expect(loader).toContain("await page.close()");
    expect(loader.indexOf("loads.next(arm)")).toBeGreaterThan(loader.indexOf("await page.close()"));
    expect(loader.indexOf("loads.next(arm)")).toBeLessThan(loader.indexOf("logBefore = await session.eventLog()"));
    expect(loader).toContain("page.goto(load.url");
    // Quiet-log polling is not a completion fence for a discarded page.
    expect(acceptance).not.toContain("waitForEventLogQuiescence");
    expect(loader).not.toContain("await page.waitForTimeout(1000)");
    expect(acceptance).not.toMatch(/kindCount\([^)]*"clickfix_detected"\)[^;]*\+ 1/u);
    expect(acceptance).not.toContain("session.url(`${PRESSURE_FIXTURE}");
  });
});
