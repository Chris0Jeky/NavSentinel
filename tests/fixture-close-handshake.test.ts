import assert from "node:assert/strict";
import vm from "node:vm";
import type { Page } from "@playwright/test";
import { describe, it } from "vitest";
import { FIXTURE_CLOSE_SCRIPT, prepareFixtureClose } from "./e2e/fixture_close_handshake";

function fixture() {
  let listener!: (event: { isTrusted: boolean }) => Promise<void>;
  let closed = 0;
  let requests = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  const permission = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  vm.runInNewContext(FIXTURE_CLOSE_SCRIPT, {
    document: { querySelector: (selector: string) => {
      assert.equal(selector, "#close");
      return { addEventListener: (type: string, callback: typeof listener) => {
        assert.equal(type, "click"); listener = callback;
      } };
    } },
    window: { close: () => { closed++; }, __nsFixtureCloseReady: () => { requests++; return permission; } },
  });
  return { click: (trusted: boolean) => listener({ isTrusted: trusted }),
    get closed() { return closed; }, get requests() { return requests; }, release, reject };
}

describe("fixture close acknowledgement (#1032)", () => {
  it("keeps the child alive until the trusted click command is acknowledged", async () => {
    const f = fixture(); const pending = f.click(true);
    assert.equal(f.requests, 1); assert.equal(f.closed, 0);
    f.release(); await pending; assert.equal(f.closed, 1);
  });
  it("ignores synthetic close activation", async () => {
    const f = fixture(); await f.click(false);
    assert.equal(f.requests, 0); assert.equal(f.closed, 0);
  });
  it("does not close if acknowledgement fails", async () => {
    const f = fixture(); const failure = new Error("ack failed");
    const rejected = assert.rejects(f.click(true), (error) => error === failure);
    f.reject(failure); await rejected; assert.equal(f.closed, 0);
  });
  it("binds one-use acknowledgement to the expected top document", async () => {
    type Source = { page: Page; frame: unknown };
    let handler!: (source: Source) => Promise<void>;
    const frame = {};
    const page = { mainFrame: () => frame, isClosed: () => false,
      exposeBinding: async (name: string, fn: typeof handler) => {
        assert.equal(name, "__nsFixtureCloseReady"); handler = fn;
      },
    } as unknown as Page;
    const control = await prepareFixtureClose(page);
    assert.throws(() => control.release());
    await assert.rejects(handler({ page: {} as Page, frame }));
    await assert.rejects(handler({ page, frame: {} }));
    assert.equal(control.requests, 0);
    const request = handler({ page, frame });
    assert.equal(control.requests, 1);
    control.release(); await request;
    assert.throws(() => control.release());
    await assert.rejects(handler({ page, frame }));
  });
});
