// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

// #1243 review: in a frame without the document_start loader, window named access can
// expose a page element or a cross-origin WindowProxy (whose properties throw) under the
// fence record's name. The module must ignore anything but its own published record, and
// loading it must not throw, or every importer (credential_guard) dies in that frame.
const NAME = "__navsentinelUiFence";
const proto = Object.getPrototypeOf(globalThis) as object;

afterEach(() => {
  Reflect.deleteProperty(proto, NAME);
  vi.resetModules();
});

it("loads and ignores a named-access value whose properties throw", async () => {
  Object.defineProperty(proto, NAME, {
    configurable: true,
    get: () => new Proxy({}, { get: () => { throw new DOMException("Blocked", "SecurityError"); } }),
  });
  const module = await import("../extension/src/content/ui_action_visibility");
  expect(typeof module.visibleActionGate).toBe("function");
});
