// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubVisibleUi } from "./helpers/visible-ui";
import { shadowOf } from "./helpers/shadow-roots";

describe("credential and toast visible approval (#1139)", () => {
  stubVisibleUi();
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
  afterEach(() => {
    // Settle pending modals first: their removal observer reattaches a removed host.
    const escape = new KeyboardEvent("keydown", { key: "Escape" });
    Object.defineProperty(escape, "isTrusted", { value: true });
    window.dispatchEvent(escape);
    vi.clearAllTimers(); vi.useRealTimers();
    document.getElementById("__sentinelsuite_cred_modal_host__")?.remove();
    document.getElementById("__navsentinel_toast_host")?.remove();
    document.documentElement.removeAttribute("data-test-route");
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

  it("keeps arming through unrelated html attribute churn", async () => {
    const p = await prompt();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(200);
      document.documentElement.setAttribute("data-test-route", String(i));
      await vi.advanceTimersByTimeAsync(1);
    }
    // Also exercise records still queued when the click samples visibility.
    document.documentElement.setAttribute("data-test-route", "last");
    expect(p.click(0)).toBe(true);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("resets arming when a mutation hides the host between animation frames", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(400);
    p.host.style.opacity = "0";
    await vi.advanceTimersByTimeAsync(1);
    p.host.style.opacity = "1";
    vi.advanceTimersByTime(450);
    expect(p.click(0)).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(850);
    expect(p.click(0)).toBe(true);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("does not bank exposure during a rendering gap despite html attribute churn", async () => {
    const p = await prompt();
    // Let the already scheduled frame run, then suspend further painted samples.
    vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(0);
    for (let i = 0; i < 17; i++) {
      vi.advanceTimersByTime(50);
      document.documentElement.setAttribute("data-test-route", String(i));
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(p.click(0)).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
  });

  it.each(["x", "y", "width", "height"] as const)("resets arming when button %s changes without a mutation", async (field) => {
    const p = await prompt();
    vi.advanceTimersByTime(400);
    const rect = p.button.getBoundingClientRect();
    vi.spyOn(p.button, "getBoundingClientRect").mockReturnValue({ ...rect, [field]: rect[field] + 2 });
    vi.advanceTimersByTime(450);
    expect(p.click(0)).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(850);
    expect(p.click(0)).toBe(true);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it("resets arming when a button is removed and reinserted between frames", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(400);
    const parent = p.button.parentElement!;
    p.button.remove();
    await vi.advanceTimersByTimeAsync(1);
    parent.appendChild(p.button);
    p.button.focus();
    vi.advanceTimersByTime(450);
    expect(p.click(0)).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(850);
    expect(p.click(0)).toBe(true);
  });

  it("tolerates subpixel jitter but resets cumulative movement from the arming box", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(400);
    const rect = p.button.getBoundingClientRect();
    const box = vi.spyOn(p.button, "getBoundingClientRect");
    box.mockReturnValue({ ...rect, x: rect.x + 0.75 });
    vi.advanceTimersByTime(200);
    box.mockReturnValue({ ...rect, x: rect.x + 1.5 });
    vi.advanceTimersByTime(250);
    expect(p.click(0)).toBe(false);
    await Promise.resolve();
    expect(p.settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(850);
    expect(p.click(0)).toBe(true);
  });

  it("keeps arming through one CSS pixel of button geometry jitter", async () => {
    const p = await prompt();
    vi.advanceTimersByTime(400);
    const rect = p.button.getBoundingClientRect();
    vi.spyOn(p.button, "getBoundingClientRect").mockReturnValue({
      ...rect, x: rect.x + 1, y: rect.y - 1, width: rect.width + 1, height: rect.height - 1,
    });
    vi.advanceTimersByTime(450);
    expect(p.click(0)).toBe(true);
    await Promise.resolve();
    expect(p.settled).toHaveBeenCalledWith("proceed");
  });

  it.each(["Enter", " "])("refuses hidden toast Undo, then accepts armed keyup %s", async (key) => {
    const toast = await import("../extension/src/content/ui_toast");
    const undo = vi.fn();
    toast.showToast({ message: "Blocked", timeoutMs: 0, actions: [{ label: "Undo", onClick: undo }] });
    const host = document.getElementById("__navsentinel_toast_host")!;
    const button = shadowOf(host)!.querySelector("button")!;
    button.focus();
    vi.advanceTimersByTime(1000);
    host.style.opacity = "0";
    toast.activateOwnedToastControl(host, [button], new MouseEvent("click", { detail: 1, clientX: 120, clientY: 40 }));
    expect(undo).not.toHaveBeenCalled();
    expect(button.isConnected).toBe(true);
    host.style.opacity = "1";
    const keyboard = new KeyboardEvent("keyup", { key });
    expect(toast.activateOwnedToastControl(host, [button], keyboard)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(toast.activateOwnedToastControl(host, [button], keyboard)).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
