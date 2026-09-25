// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchUntrusted, stubTrustedInput } from "./helpers/trusted-input";
import type { showCredentialModal as ShowCredentialModalType } from "../extension/src/content/credential_modal";
import type { ModalSpec } from "../extension/src/content/credential_modal";

const HOST_ID = "__sentinelsuite_cred_modal_host__";

let showCredentialModal: typeof ShowCredentialModalType;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/content/credential_modal");
  showCredentialModal = mod.showCredentialModal;
}

function getHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

function getShadow(): ShadowRoot | null {
  return getHost()?.shadowRoot ?? null;
}

function getOverlay(): HTMLElement | null {
  return getShadow()?.querySelector(".overlay") as HTMLElement | null;
}

function getButtons(): HTMLElement[] {
  const footer = getShadow()?.querySelector(".footer");
  if (!footer) return [];
  return Array.from(footer.querySelectorAll("button"));
}

function minimalSpec(): ModalSpec {
  return {
    title: "Test Warning",
    actions: [
      { id: "allow", label: "Allow", kind: "primary" },
      { id: "block", label: "Block", kind: "danger" },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("credential modal trusted input gating (#826)", () => {
  stubTrustedInput();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    vi.resetModules();
    document.getElementById(HOST_ID)?.remove();
    await loadModule();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(HOST_ID)?.remove();
  });

  it("ignores an untrusted button click: prompt stays pending", async () => {
    const promise = showCredentialModal(minimalSpec());
    vi.runAllTimers();
    let settled: string | null = null;
    void promise.then((id) => {
      settled = id;
    });

    // What page script can do through the open shadow root: reach the button
    // and dispatch a synthetic click. It must not resolve the prompt.
    const allow = getButtons().find((b) => b.textContent === "Allow")!;
    dispatchUntrusted(allow, new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    expect(settled).toBe(null);
    expect(getOverlay()).not.toBe(null);

    // Cleanup via a trusted Escape (reads trusted under the shim).
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await promise;
  });

  it("ignores an untrusted Escape keydown", async () => {
    const promise = showCredentialModal(minimalSpec());
    vi.runAllTimers();
    let settled: string | null = null;
    void promise.then((id) => {
      settled = id;
    });

    dispatchUntrusted(window, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushMicrotasks();

    expect(settled).toBe(null);
    expect(getOverlay()).not.toBe(null);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await promise;
  });

  it("ignores an untrusted outside mousedown on the backdrop", async () => {
    const promise = showCredentialModal(minimalSpec());
    vi.runAllTimers();
    let settled: string | null = null;
    void promise.then((id) => {
      settled = id;
    });

    dispatchUntrusted(getOverlay()!, new MouseEvent("mousedown", { bubbles: true }));
    await flushMicrotasks();

    expect(settled).toBe(null);
    expect(getOverlay()).not.toBe(null);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await promise;
  });

  it("ignores an untrusted Tab keydown: page script cannot steer focus between actions", async () => {
    const promise = showCredentialModal(minimalSpec());
    vi.runAllTimers();

    // Focus sits on the last action. A synthetic Tab from page script would
    // otherwise wrap focus onto the first action ("Allow"), so the user's next
    // real Enter or Space would activate a button they did not choose.
    const buttons = getButtons();
    buttons[1]!.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    dispatchUntrusted(window, tab);

    expect(tab.defaultPrevented).toBe(false);
    expect(getShadow()!.activeElement).toBe(buttons[1]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await promise;
  });

  it("still resolves on trusted input (shim sanity)", async () => {
    const promise = showCredentialModal(minimalSpec());
    vi.runAllTimers();

    getButtons().find((b) => b.textContent === "Allow")!.click();
    await expect(promise).resolves.toBe("allow");
  });
});
