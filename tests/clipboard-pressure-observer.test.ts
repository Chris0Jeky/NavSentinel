import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  OutboundQueue, coalesceKeyForMainGuardMessage, isMainGuardAlertType, isFloodableAlertType,
} from "../extension/src/content/bridge_outbound";
import { looksLikeCommand } from "../extension/src/content/command_keywords";
import {
  buildClipboardPressureObservedBundle, instrumentClipboardQueue,
  PRESSURE_OBSERVER_MARKER, PRESSURE_OBSERVER_PROPERTY, readClipboardPressureObserverMarker,
  withClipboardPressureObservedBundle,
  type ClipboardQueueEvidence,
} from "./acceptance/clipboard-pressure-observed-bundle";

const source = fs.readFileSync("extension/src/content/main_guard.ts", "utf8");
const file = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
const functions = new Set(["postToIsolated", "flushPendingOutbound", "clearBridgeHandshakeTimer", "failBridgeHandshake", "patchClipboard"]);
const variables = new Set(["bridgePort", "bridgeSession", "bridgeVerified", "bridgeChallenge", "bridgeHandshakeTimer", "pendingOutbound"]);
const declarations = file.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name && functions.has(node.name.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ts.isIdentifier(declaration.name) && variables.has(declaration.name.text))) ||
  (ts.isExpressionStatement(node) && node.getText(file).startsWith("window.addEventListener(") && node.getText(file).includes("ns-challenge-response")));
if (declarations.length !== functions.size + variables.size + 1) throw new Error("Expected the actual queue, clipboard and challenge declarations");
const compiled = ts.transpileModule(declarations.map((node) => node.getText(file)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type BridgeRow = { type: string; looksLikeCommand?: boolean; dropped?: number };
/** Execute the actual production declarations with a modeled native clipboard and MessagePort. */
function boot(regressed = false, observed = true, nativeWrite: (value: string) => Promise<void> = () => Promise.resolve()) {
  let init: (event: unknown) => void = () => { throw new Error("No actual bridge init listener"); };
  const clipboard = { writeText: (value: string) => nativeWrite(value) };
  const rows: BridgeRow[] = [];
  const readySnapshots: ClipboardQueueEvidence[] = [];
  const evidence = () => context[PRESSURE_OBSERVER_PROPERTY] as ClipboardQueueEvidence;
  class MessagePort {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage(message: BridgeRow) {
      rows.push(message);
      if (observed && message.type === "ns-bridge-ready") readySnapshots.push(evidence());
    }
    start() {}
    close() {}
  }
  const window = {
    addEventListener: (_name: string, callback: (event: unknown) => void) => { init = callback; },
    setTimeout: () => 1,
  };
  const context = vm.createContext({
    window, navigator: { clipboard }, MessagePort, OutboundQueue,
    coalesceKeyForMainGuardMessage: regressed ? () => undefined : coalesceKeyForMainGuardMessage,
    isMainGuardAlertType, isFloodableAlertType, looksLikeCommand,
    MAX_PENDING_OUTBOUND: 32, RESERVED_SCARCE_OUTBOUND_SLOTS: 8,
    NS_SOURCE: "__navsentinel__", PROTOCOL_VERSION: 1, BRIDGE_INIT_TYPE: "ns-port-init",
    BRIDGE_HANDSHAKE_TIMEOUT_MS: 3000, clearTimeout: () => undefined,
    generateChallenge: () => "actual-challenge", handleBridgeMessage: () => undefined,
    nativeClipboardWriteText: clipboard.writeText, nativeClipboardWrite: null,
    nativeApply: Reflect.apply, nowMs: () => 105, debug: false,
  });
  vm.runInContext(observed ? instrumentClipboardQueue(compiled, "test-artifact") : compiled, context);
  vm.runInContext('patchClipboard();postToIsolated("ns-main-guard-ready");', context);
  const begin = () => {
    const port = new MessagePort();
    init({ source: window, data: { source: "__navsentinel__", v: 1, type: "ns-port-init", session: "same-document-session" },
      ports: [port], stopImmediatePropagation() {}, stopPropagation() {} });
    return port;
  };
  const verify = (port: MessagePort) => port.onmessage?.({ data: {
    source: "__navsentinel__", type: "ns-challenge-response", challenge: "actual-challenge",
  } });
  const burst = async (attack = true) => {
    const values = Array.from({ length: 40 }, (_, index) => `CF06-FLOOD-${1000 + index}`);
    if (attack) values.push("NAVSENTINEL_SENTINEL_DO_NOT_RUN base64");
    await Promise.all(values.map((value) => clipboard.writeText(value)));
  };
  return { clipboard, rows, evidence, begin, verify, burst, readySnapshots };
}

describe("synchronous diagnostic observation of the actual MAIN queue", () => {
  it("records queue entry and freezes before bridge-ready or the drain", async () => {
    const h = boot();
    const port = h.begin();
    await h.burst();
    expect(h.evidence().firstVerification).toBeNull();
    h.verify(port);
    expect(h.evidence()).toMatchObject({ verificationCount: 1, queuedAfterVerification: 0,
      firstVerification: { clipboardEnqueueCalls: 41, other: 40, commandLike: 1, queueSize: 3, coalesced: 39, dropped: 0 } });
    expect(h.evidence()).toMatchObject({ drainCount: 1, drainsBeforeVerification: 0,
      firstDrain: { verificationCount: 1, total: 3, commandLike: 1, other: 1, dropped: 0, coalesced: 39 } });
    expect(h.readySnapshots).toEqual([{ ...h.evidence(), drainCount: 0, firstDrain: null }]);
    expect(h.rows.filter((row) => row.type === "ns-clipboard-write")).toHaveLength(2);
    expect(h.rows.some((row) => row.type === "ns-clipboard-write" && row.looksLikeCommand)).toBe(true);
    expect(h.rows.some((row) => row.type === "ns-bridge-overflow")).toBe(false);
    expect(JSON.stringify(h.evidence())).not.toMatch(/CF06|SENTINEL|actual-challenge|same-document-session/u);
  });

  it("does not count post-verification receipts or flushed receipts as queue entries", async () => {
    const h = boot();
    h.verify(h.begin());
    await h.burst();
    expect(h.evidence().firstVerification).toMatchObject({ clipboardEnqueueCalls: 0, commandLike: 0, other: 0 });
    expect(h.rows.filter((row) => row.type === "ns-clipboard-write")).toHaveLength(41);
  });

  it("a pending native promise is not queue evidence; resolving it after verification is too late", async () => {
    let finish!: () => void;
    const h = boot(false, true, () => new Promise<void>((resolve) => { finish = resolve; }));
    const port = h.begin();
    const pending = h.clipboard.writeText("benign value");
    h.verify(port);
    finish();
    await pending;
    expect(h.evidence().firstVerification?.clipboardEnqueueCalls).toBe(0);
    expect(h.rows.filter((row) => row.type === "ns-clipboard-write")).toHaveLength(1);
  });

  it("does not substitute later retry counts for the first accepted verification", async () => {
    const h = boot();
    h.verify(h.begin());
    const retry = h.begin();
    await h.burst();
    h.verify(retry);
    expect(h.evidence()).toMatchObject({ verificationCount: 2, queuedAfterVerification: 41,
      firstVerification: { clipboardEnqueueCalls: 0, other: 0, commandLike: 0 } });
  });

  it("keeps the same direct witness valid on the #599 regression while behavior still fails", async () => {
    const h = boot(true);
    const port = h.begin();
    await h.burst();
    h.verify(port);
    expect(h.evidence().firstVerification).toMatchObject({ clipboardEnqueueCalls: 41, other: 40, commandLike: 1,
      queueSize: 32, coalesced: 0, dropped: 10 });
    expect(h.rows.some((row) => row.type === "ns-clipboard-write" && row.looksLikeCommand)).toBe(false);
    expect(h.rows.find((row) => row.type === "ns-bridge-overflow")?.dropped).toBe(10);
    expect(h.evidence()).toMatchObject({ drainCount: 1, drainsBeforeVerification: 0,
      firstDrain: { verificationCount: 1, total: 32, commandLike: 0, other: 32, dropped: 10, coalesced: 0 } });
  });

  it("distinguishes command retention when identical admission counts hide different native completion orders", async () => {
    async function run(commandFirst: boolean) {
      const pending: Array<{ value: string; resolve: () => void }> = [];
      const h = boot(true, true, (value) => new Promise<void>((resolve) => { pending.push({ value, resolve }); }));
      const port = h.begin();
      const burst = h.burst();
      // Let the VM's async wrappers attach to the modeled native promises.
      await Promise.resolve();
      const ordered = commandFirst ? [pending[40]!, ...pending.slice(0, 40)] : pending;
      for (const write of ordered) write.resolve();
      await burst;
      h.verify(port);
      return h;
    }
    const commandLast = await run(false);
    const commandFirst = await run(true);
    expect(commandLast.evidence().firstVerification).toEqual(commandFirst.evidence().firstVerification);
    expect(commandLast.evidence().firstDrain).toMatchObject({ commandLike: 0, other: 32 });
    expect(commandFirst.evidence().firstDrain).toMatchObject({ commandLike: 1, other: 31 });
    expect(commandFirst.rows.filter((row) => row.type === "ns-clipboard-write" && row.looksLikeCommand)).toHaveLength(1);
  });

  it.each([false, true])("preserves uninstrumented queue outputs with regression=%s", async (regressed) => {
    const raw = boot(regressed, false);
    const observed = boot(regressed);
    const rawPort = raw.begin();
    const observedPort = observed.begin();
    await raw.burst();
    await observed.burst();
    raw.verify(rawPort);
    observed.verify(observedPort);
    expect(observed.rows).toEqual(raw.rows);
  });

  it("fails closed on duplicate or missing queue/verification anchors", () => {
    expect(() => instrumentClipboardQueue(compiled.replace("pendingOutbound.enqueue(", "otherQueue.submit("), "x")).toThrow("TEST_INVALID");
    expect(() => instrumentClipboardQueue(`${compiled}\nbridgeVerified = true;`, "x")).toThrow("TEST_INVALID");
    expect(() => instrumentClipboardQueue(compiled.replace("bridgeVerified = true;", "bridgeVerified = false;"), "x")).toThrow("TEST_INVALID");
    expect(() => instrumentClipboardQueue(instrumentClipboardQueue(compiled, "x"), "y")).toThrow("already has a queue observer");
    expect(() => instrumentClipboardQueue(`${compiled}\npendingOutbound.drain();`, "x")).toThrow("TEST_INVALID");
    expect(() => instrumentClipboardQueue(compiled.replace("pendingOutbound.drain()", "otherQueue.drain()"), "x")).toThrow("TEST_INVALID");
    expect(() => instrumentClipboardQueue(compiled.replace("flushPendingOutbound();", "otherFlush();"), "x")).toThrow("TEST_INVALID");
  });

  it("hash-binds a separate copy and cleans it on success or browser-open failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pressure-observer-test-"));
    try {
      const dist = path.join(root, "source");
      fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dist, "manifest.json"), "{}\n");
      fs.writeFileSync(path.join(dist, "assets", "main_guard.ts-test.js"), compiled);
      const result = buildClipboardPressureObservedBundle(dist, path.join(root, "observed"));
      expect(fs.readFileSync(path.join(dist, "assets", "main_guard.ts-test.js"), "utf8")).toBe(compiled);
      expect(readClipboardPressureObserverMarker(result.extensionPath)).toEqual(result.marker);
      expect(result.marker.sourceSha256).not.toBe(result.marker.observedSha256);
      expect(result.marker.sourceBundleSha256).not.toBe(result.marker.observedBundleSha256);
      expect(fs.existsSync(path.join(dist, PRESSURE_OBSERVER_MARKER))).toBe(false);
      fs.appendFileSync(path.join(result.extensionPath, "manifest.json"), " ");
      expect(() => readClipboardPressureObserverMarker(result.extensionPath)).toThrow("bundle hash does not match");
      fs.writeFileSync(path.join(result.extensionPath, "manifest.json"), "{}\n");
      fs.appendFileSync(path.join(result.extensionPath, "assets", result.marker.patchedAsset), "\n// altered");
      expect(() => readClipboardPressureObserverMarker(result.extensionPath)).toThrow("hash does not match");
      expect(() => readClipboardPressureObserverMarker(dist)).toThrow("needs a marked diagnostic copy");
      const completedPath = await withClipboardPressureObservedBundle(dist, async (bundle) => bundle.extensionPath);
      expect(fs.existsSync(path.dirname(completedPath))).toBe(false);
      let failedPath = "";
      const failure = new Error("browser open failed");
      await expect(withClipboardPressureObservedBundle(dist, async (bundle) => {
        failedPath = bundle.extensionPath;
        throw failure;
      })).rejects.toBe(failure);
      expect(failedPath).not.toBe("");
      expect(fs.existsSync(path.dirname(failedPath))).toBe(false);
      expect(fs.readFileSync(path.join(dist, "assets", "main_guard.ts-test.js"), "utf8")).toBe(compiled);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("session-local diagnostic bundle selection", () => {
  it("uses the selected copy for launch, restart and receipt while other sessions keep their default", async () => {
    const harness = fs.readFileSync("tests/acceptance/acceptance_harness.ts", "utf8");
    const ast = ts.createSourceFile("harness.ts", harness, ts.ScriptTarget.Latest, true);
    const declarations = ast.statements.filter((node) =>
      (ts.isFunctionDeclaration(node) && node.name?.text === "launchProfile") ||
      (ts.isClassDeclaration(node) && node.name?.text === "AcceptanceSession"));
    expect(declarations).toHaveLength(2);
    const executable = ts.transpileModule(declarations.map((node) => node.getText(ast)).join("\n"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const launches: string[][] = [];
    const manifestReads: string[] = [];
    const hashes: string[] = [];
    const defaultDist = path.resolve("/source-dist");
    const observedDist = path.resolve("/observed-copy");
    const worker = {
      url: () => "chrome-extension://abcdefghijklmnopabcdefghijklmnop/service-worker-loader.js",
      evaluate: async () => ["Google Chrome"],
    };
    const browserContext = { serviceWorkers: () => [worker], browser: () => ({ version: () => "test" }), close: async () => undefined };
    const sandbox = vm.createContext({
      exports: {}, extensionPath: defaultDist, path, os, URL, Date,
      WORKER_SUFFIX: "/service-worker-loader.js", process: { env: {} },
      chromium: { launchPersistentContext: async (_profile: string, options: { args: string[] }) => {
        launches.push(options.args); return browserContext;
      } },
      fs: { existsSync: () => true, mkdirSync() {}, rmSync() {}, mkdtempSync: () => "/profile",
        readFileSync: (file: string) => { manifestReads.push(file); return '{"version":"test-version"}'; } },
      test: { skip() {} }, selectBrandedChrome: () => ({}), readBuiltUiGuardRevision: () => "source-guard",
      git: (args: string[]) => args[0] === "status" ? "" : "exact-source-head",
      startAcceptanceServer: async () => ({ baseUrl: "http://127.0.0.1:1", close: async () => undefined }),
      hashDirectory: (directory: string) => { hashes.push(directory); return `hash:${directory}`; },
      readDevToolsPort: async () => 1, acceptanceRunDirectory: () => "/receipts", slug: () => "test",
    });
    vm.runInContext(`${executable}\nAcceptanceSession.prototype.wireConsole=function(){};
      AcceptanceSession.prototype.closeOnboarding=async function(){};
      AcceptanceSession.prototype.closePopup=async function(){};`, sandbox);
    type Session = { receipt: { build: { distSha256: string; diagnosticBundle?: { extensionPath: string; classification: string } } }; restartBrowser(): Promise<void> };
    const SessionClass = vm.runInContext("AcceptanceSession", sandbox) as {
      open(info: object, guide: string, diagnostic?: { extensionPath: string; classification: string }): Promise<Session>;
    };
    const ordinary = await SessionClass.open({}, "ordinary");
    const observed = await SessionClass.open({}, "diagnostic", {
      extensionPath: observedDist, classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE",
    });
    await ordinary.restartBrowser();
    await observed.restartBrowser();
    expect(launches.map((args) => args.filter((arg) => arg.includes("extension")))).toEqual([
      [`--disable-extensions-except=${defaultDist}`, `--load-extension=${defaultDist}`],
      [`--disable-extensions-except=${observedDist}`, `--load-extension=${observedDist}`],
      [`--disable-extensions-except=${defaultDist}`, `--load-extension=${defaultDist}`],
      [`--disable-extensions-except=${observedDist}`, `--load-extension=${observedDist}`],
    ]);
    expect(manifestReads).toEqual([path.join(defaultDist, "manifest.json"), path.join(observedDist, "manifest.json")]);
    expect(hashes).toEqual([defaultDist, observedDist]);
    expect(ordinary.receipt.build).toMatchObject({ distSha256: `hash:${defaultDist}` });
    expect(ordinary.receipt.build).not.toHaveProperty("diagnosticBundle");
    expect(observed.receipt.build).toMatchObject({ distSha256: `hash:${observedDist}`,
      diagnosticBundle: { extensionPath: observedDist, classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE" } });
    expect(sandbox.extensionPath).toBe(defaultDist);
  });
});
