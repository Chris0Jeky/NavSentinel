import { beforeEach, describe, expect, it, vi } from "vitest";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../extension/src/content/ui_toast", () => ({ showToast }));

import { warn } from "../extension/src/content/tabnab_warning";

describe("tabnab warn (#1172)", () => {
  beforeEach(() => showToast.mockClear());

  it("shows a warn-only toast naming the original site", () => {
    warn({ from: "bank.example" });
    const opts = showToast.mock.calls[0]![0];
    expect(opts.message).toContain("Another tab changed this page from bank.example while you were away.");
    expect(opts.actions).toBeUndefined();
  });

  it("shows a persistent warn-only toast naming the sending site (device-code)", () => {
    warn({ kind: "devicecode", from: "docs-share.example" });
    const opts = showToast.mock.calls[0]![0];
    expect(opts.message).toContain("docs-share.example sent you to this device sign-in page.");
    expect(opts.message).toContain("Only enter a code that your own TV, console or command line showed you.");
    expect(opts.timeoutMs).toBe(0);
    expect(opts.persistent).toBe(true);
    expect(opts.actions).toBeUndefined();
  });

  it.each([undefined, "<img src=x onerror=1>"])("never echoes a malformed device-code site (%j)", (from) => {
    warn({ kind: "devicecode", from });
    const message = showToast.mock.calls[0]![0].message;
    expect(message).toMatch(/^A website sent you to a device sign-in page\. Only enter/);
    expect(message).not.toContain("<");
  });

  it("never echoes a malformed site value", () => {
    warn({ from: "<img src=x onerror=1>" });
    expect(showToast.mock.calls[0]![0].message).toBe(
      "Another tab changed this page while you were away. Check the address before you sign in.");
  });
});
