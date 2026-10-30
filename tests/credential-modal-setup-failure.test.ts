// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ fail: true }));
vi.mock("../extension/src/content/ui_action_visibility", () => ({
  visibleActionGate: () => {
    if (gate.fail) throw new Error("setup failed");
    return { accepts: () => true, dispose: () => {} };
  },
}));

describe("credential prompt setup failure (#1215)", () => {
  afterEach(() => document.getElementById("__sentinelsuite_cred_modal_host__")?.remove());

  it("does not leave a teardown that breaks every later prompt", async () => {
    const modal = await import("../extension/src/content/credential_modal");
    const spec = { title: "Credentials", actions: [{ id: "proceed", label: "Proceed once" }] };
    await expect(modal.showCredentialModal(spec)).rejects.toThrow("setup failed");
    gate.fail = false;
    void modal.showCredentialModal(spec);
    expect(modal.credentialModalRoot()?.querySelector("button")?.textContent).toBe("Proceed once");
  });
});
