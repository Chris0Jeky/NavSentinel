import { beforeEach, describe, expect, it, vi } from "vitest";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../extension/src/content/ui_toast", () => ({ showToast }));

import { showTabnabWarning } from "../extension/src/content/tabnab_warning";

describe("showTabnabWarning (#1172)", () => {
  beforeEach(() => showToast.mockClear());

  it("shows a warn-only toast naming the original site", () => {
    showTabnabWarning("bank.example");
    const opts = showToast.mock.calls[0]![0];
    expect(opts.message).toContain("Another tab changed this page from bank.example while you were away.");
    expect(opts.actions).toBeUndefined();
  });

  it("never echoes a malformed site value", () => {
    showTabnabWarning("<img src=x onerror=1>");
    expect(showToast.mock.calls[0]![0].message).toBe(
      "Another tab changed this page while you were away. Check the address before you sign in.");
  });
});
