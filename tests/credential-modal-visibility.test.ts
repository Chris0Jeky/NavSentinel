// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubVisibleUi } from "./helpers/visible-ui";

describe("credential and toast visible approval (#1139)", () => {
  stubVisibleUi();
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers();
    document.getElementById("__sentinelsuite_cred_modal_host__")?.remove();
    document.getElementById("__navsentinel_toast_host")?.remove();
  });

  async function prompt() {
    const modal = await import("../extension/src/content/credential_modal");
    const settled = vi.fn();
    void modal.showCredentialModal({ title: "Credentials", actions: [{ id: "proceed", label: "Proceed once" }] }).then(settled);
    const host = document.getElementById("__sentinelsuite_cred_modal_host__")!;
    const root = modal.credentialModalRoot()!;
    const button = root.querySelector("button")!;
    button.focus();
    const click = (detail = 1) => modal.activateOwnedModalControl(host, [button], new MouseEvent("click", { detail, clientX: 120, clientY: 40 }));
    return { host, root, button, settled, click };
  }

  it.each(["opacity:0", "visibility:hidden", "display:none", "filter:opacity(0)", "clip-path:inset(100%)"])("refuses %s and keeps the decision pending", async (css) => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    p.host.style.cssText += css;
    expect(p.click()).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    expect(p.root.querySelector("button")).toBe(p.button);
    p.host.style.cssText = "";
    p.click();
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    p.click();
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("refuses a covering page element and a closed popover", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    p.click();
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.mocked(document.elementFromPoint).mockReturnValue(p.host);
    p.host.setAttribute("data-test-closed", "");
    vi.advanceTimersByTime(1000);
    p.click();
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
  });

  it("uses the CSS and geometry fallback when checkVisibility is unavailable", async () => {
    const p = await prompt();
    Object.defineProperty(p.host, "checkVisibility", { value: undefined });
    p.host.style.opacity = "0";
    vi.advanceTimersByTime(1000);
    expect(p.click()).toBe(false);
    p.host.style.opacity = "1";
    vi.advanceTimersByTime(1000);
    expect(p.click(0)).toBe(true);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("refuses before arming and permits focused keyboard activation after arming", async () => {
    const p = await prompt();
    p.click(0);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    p.click(0);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("refuses a hidden button, an unfocused keyboard click, and a hit outside the button", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    p.button.style.visibility = "hidden";
    expect(p.click()).toBe(false);
    p.button.style.visibility = "visible";
    vi.advanceTimersByTime(1000);
    p.button.blur();
    expect(p.click(0)).toBe(false);
    p.button.focus();
    vi.advanceTimersByTime(1000);
    const modal = await import("../extension/src/content/credential_modal");
    expect(modal.activateOwnedModalControl(p.host, [p.button], new MouseEvent("click", { detail: 1, clientX: 900, clientY: 700 }))).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
  });

  it("resets continuous exposure when hidden between clicks", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(1000);
    p.host.style.opacity = "0";
    vi.advanceTimersByTime(32);
    p.host.style.opacity = "1";
    vi.advanceTimersByTime(100);
    p.click();
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
  });

  it("does not invoke a hidden toast Undo or remove its card", async () => {
    const toast = await import("../extension/src/content/ui_toast");
    const undo = vi.fn();
    toast.showToast({ message: "Blocked", timeoutMs: 0, actions: [{ label: "Undo", onClick: undo }] });
    const host = document.getElementById("__navsentinel_toast_host")!;
    const button = host.shadowRoot!.querySelector("button")!;
    button.focus();
    vi.advanceTimersByTime(1000);
    host.style.opacity = "0";
    toast.activateOwnedToastControl(host, [button], new MouseEvent("click", { detail: 1, clientX: 120, clientY: 40 }));
    expect(undo).not.toHaveBeenCalled();
    expect(button.isConnected).toBe(true);
    host.style.opacity = "1";
    const keyboard = new MouseEvent("click", { detail: 0 });
    expect(toast.activateOwnedToastControl(host, [button], keyboard)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(toast.activateOwnedToastControl(host, [button], keyboard)).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
