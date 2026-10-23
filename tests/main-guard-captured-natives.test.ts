import vm from "node:vm";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  assertEarlyMainPrelude, EARLY_MAIN_NATIVES, installEarlyMainClockText,
} from "../scripts/content-loader-contract.mjs";

const source = readFileSync("extension/src/content/main_guard.ts", "utf8");
const ast = ts.createSourceFile("main_guard.ts", source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && ["isFormSelfTarget", "looksLikePopupOpen", "resolveAgainstBase",
    "pathLooksCrossOrigin", "postToIsolated", "failBridgeHandshake"].includes(node.name?.text ?? ""));
const compiled = ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function realm() {
  // Native DOM doubles supply only the brand/sink behavior. Decisions and the
  // document-start capture block are actual production code in their own realm.
  const context = vm.createContext({ URL });
  vm.runInContext(`
    class MessagePort {
      sent = []; started = false; closed = false; handler = null;
      postMessage(message) { this.sent[this.sent.length] = message; }
      start() { this.started = true; }
      close() { this.closed = true; }
      set onmessage(handler) { this.handler = handler; }
    }
    class MessageEvent { get data() { return this.payload; } get source() { return this.sender; } get ports() { return this.transferred; } }
    class Event { stopImmediatePropagation() {} }
    class EventTarget { addEventListener() {} }
    globalThis.MessagePort = MessagePort; globalThis.MessageEvent = MessageEvent;
    globalThis.Event = Event; globalThis.EventTarget = EventTarget;
    globalThis.window = { name: 'child' };
    globalThis.location = { href: 'https://fixture.test/page', origin: 'https://fixture.test', hostname: 'fixture.test' };
    globalThis.documentBaseUrl = () => 'https://fixture.test/base/';
    globalThis.bridgePort = new MessagePort(); globalThis.bridgeSession = 'test-session';
    globalThis.bridgeVerified = true; globalThis.bridgeChallenge = null;
    globalThis.NS_SOURCE = '__navsentinel__'; globalThis.PROTOCOL_VERSION = 1;
    globalThis.bridgeHandshakeTimer = 0;
  `, context);
  vm.runInContext(EARLY_MAIN_NATIVES, context);
  // Capture occurs before page code AND before the guard's async module body.
  vm.runInContext(`
    String.prototype.toLowerCase = function() { return '_self'; };
    String.prototype.trim = function() { return ''; };
    String.prototype.includes = () => false;
    String.prototype.startsWith = () => false;
    String.prototype[Symbol.split] = () => [];
    Array.prototype.push = function() { throw new Error('page push'); };
    Array.prototype.filter = () => [];
    Array.prototype.splice = () => [];
    Array.prototype.findIndex = () => -1;
    Array.prototype.indexOf = () => -1;
    Array.prototype.shift = () => 0;
    Set.prototype.has = () => false;
    RegExp.prototype.exec = () => null;
    MessagePort.prototype.postMessage = function() { throw new Error('page got genuine port'); };
    MessagePort.prototype.start = MessagePort.prototype.close = function() { throw new Error('page got genuine port'); };
    Object.defineProperty(MessagePort.prototype, 'onmessage', { set() { throw new Error('page got genuine port'); } });
    Object.defineProperty(MessageEvent.prototype, 'data', { get() { throw new Error('page got message'); } });
    globalThis.URL = function() { throw new Error('page URL'); };
    Reflect.apply = () => { throw new Error('page apply'); };
    Function.prototype.call = () => { throw new Error('page call'); };
  `, context);
  vm.runInContext(`const natives = globalThis.__navsentinelMainNatives;\n${compiled}`, context);
  return context;
}

describe("document-start natives used by actual MAIN guard functions", () => {
  it("keeps reserved targets blocked and genuine self/named targets usable before module evaluation", () => {
    const context = realm();
    for (const target of ["_top", "_TOP", "_parent", "_blank"]) {
      expect(vm.runInContext(`isFormSelfTarget(${JSON.stringify(target)})`, context)).toBe(false);
    }
    for (const target of ["", "_self", "_SELF", "child"]) {
      expect(vm.runInContext(`isFormSelfTarget(${JSON.stringify(target)})`, context)).toBe(true);
    }
    expect(vm.runInContext("looksLikePopupOpen('_self', 'width=500')", context)).toBe(true);
    expect(vm.runInContext("looksLikePopupOpen('_self', '')", context)).toBe(false);
    expect(vm.runInContext("resolveAgainstBase('../sink')", context)).toBe("https://fixture.test/sink");
    expect(vm.runInContext("pathLooksCrossOrigin('/accounts.example.com/signin')", context)).toBe(true);
    expect(vm.runInContext("pathLooksCrossOrigin('/dashboard')", context)).toBe(false);
  });

  it("posts and tears down without exposing the port, listener or message through page methods", () => {
    const context = realm();
    expect(vm.runInContext(`
      natives.start(bridgePort);
      natives.listen(bridgePort, () => {});
      const event = new MessageEvent(); event.payload = { type: 'ns-ping' };
      postToIsolated(natives.data(event).type);
      bridgePort.started && typeof bridgePort.handler === 'function' &&
        bridgePort.sent[0].session === 'test-session' && bridgePort.sent[0].type === 'ns-ping';
    `, context)).toBe(true);
    expect(vm.runInContext("const prior = bridgePort; bridgeVerified = false; failBridgeHandshake(); prior.closed && bridgePort === null", context))
      .toBe(true);
  });

  it("freezes the capture record and rejects missing, duplicate or late loader captures", () => {
    const context = realm();
    expect(vm.runInContext("Object.isFrozen(natives)", context)).toBe(true);
    expect(vm.runInContext("Object.getOwnPropertyDescriptor(globalThis, '__navsentinelMainNatives').configurable", context)).toBe(false);
    const generated = "(function(){'use strict';(async()=>{await import('guard.js')})()})();";
    const loader = installEarlyMainClockText(generated);
    expect(() => assertEarlyMainPrelude(loader)).not.toThrow();
    expect(() => assertEarlyMainPrelude(loader.replace(EARLY_MAIN_NATIVES, ""))).toThrow();
    expect(() => assertEarlyMainPrelude(loader + EARLY_MAIN_NATIVES)).toThrow();
    expect(() => assertEarlyMainPrelude(loader.replace(EARLY_MAIN_NATIVES, "") + EARLY_MAIN_NATIVES)).toThrow();
    // Evaluating again after page tampering preserves the original frozen record.
    vm.runInContext(EARLY_MAIN_NATIVES, context);
    expect(vm.runInContext("natives === globalThis.__navsentinelMainNatives", context)).toBe(true);
  });

  it("keeps shared URL/gesture decisions and buffered bridge messages intact after array tampering", () => {
    const context = realm();
    for (const file of ["main_guard_helpers", "bridge_outbound"]) {
      const code = ts.transpileModule(readFileSync(`extension/src/content/${file}.ts`, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      vm.runInContext(`globalThis.exports = {};\n${code}`, context);
      if (file === "main_guard_helpers") {
        expect(vm.runInContext(`
          const state = exports.createRedirectAllowance();
          const limits = { ttlMs: 1000, maxPerGesture: 2, maxPendingFollowUps: 8 };
          exports.armSameTaskRedirect(state, 100, 100, { restrict: false, target: '' }, limits);
          exports.consumeRedirect(state, 100, 'https://fixture.test/sink', limits);
          exports.applyIsolatedRedirectAllowance(state, 101, { allowRedirect: true, restrict: false, target: '', gestureTs: 100 }, limits);
          state.count === 1 && state.pendingFollowUps.length === 0 &&
            exports.resolveFormActionUrl('  ../sink\t', location.href, 'https://fixture.test/base/') === 'https://fixture.test/sink' &&
            exports.matchesAnchorOpenIntent({ origin: location.origin, pathname: '/sink', until: 1000 }, 100,
              '/sink', '_top', location.href) === false &&
            exports.pruneTimestampWindow([1, 2, 99, 100], 100, 10, 1)[0] === 100;
        `, context)).toBe(true);
      } else {
        expect(vm.runInContext(`
          const queue = new exports.OutboundQueue(4, 1);
          queue.enqueue({ type: 'ns-nav-blocked' }, true);
          queue.enqueue({ type: 'ns-pong' });
          const drained = queue.drain().items;
          drained.length === 2 && drained[0].type === 'ns-nav-blocked' && drained[1].type === 'ns-pong' &&
            exports.isMainGuardAlertType('ns-allow-target-nav');
        `, context)).toBe(true);
      }
    }
  });
});
