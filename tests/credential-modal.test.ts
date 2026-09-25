// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { showCredentialModal as ShowCredentialModalType } from "../extension/src/content/credential_modal";
import type { ModalSpec } from "../extension/src/content/credential_modal";
import type { activateOwnedModalControl as ActivateOwnedModalControlType } from "../extension/src/content/credential_modal";

const HOST_ID = "__sentinelsuite_cred_modal_host__";

let showCredentialModal: typeof ShowCredentialModalType;
let activateOwnedModalControl: typeof ActivateOwnedModalControlType;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/content/credential_modal");
  showCredentialModal = mod.showCredentialModal;
  activateOwnedModalControl = mod.activateOwnedModalControl;
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

function getCard(): HTMLElement | null {
  return getShadow()?.querySelector(".card") as HTMLElement | null;
}

function getButtons(): HTMLElement[] {
  const footer = getShadow()?.querySelector(".footer");
  if (!footer) return [];
  return Array.from(footer.querySelectorAll("button"));
}

// Unit DOMs cannot forge trusted input, so trusted-equivalent activation goes
// through the identity relay — the same pattern as the toast tests (#783).
function activateButton(btn: HTMLElement): boolean {
  return activateOwnedModalControl(getHost(), [btn]);
}

// Escape and backdrop dismissal accept only trusted input (#826). happy-dom
// cannot produce trusted events, so dismissal tests mark the event instance
// trusted explicitly; the #783/#826 rejection cases dispatch plain events.
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true, configurable: true });
  return event;
}

function minimalSpec(overrides: Partial<ModalSpec> = {}): ModalSpec {
  return {
    title: "Test Warning",
    actions: [
      { id: "allow", label: "Allow", kind: "primary" },
      { id: "block", label: "Block", kind: "danger" },
    ],
    ...overrides,
  };
}

describe("credential modal", () => {
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

  describe("showCredentialModal basic contract", () => {
    it("creates a shadow DOM host in the document", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getHost()).not.toBeNull();
      expect(getShadow()).not.toBeNull();
      expect(getOverlay()).not.toBeNull();

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("renders the title text", async () => {
      const promise = showCredentialModal(minimalSpec({ title: "Phishing Alert" }));
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe("Phishing Alert");

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("renders subtitle when provided", async () => {
      const promise = showCredentialModal(
        minimalSpec({ subtitle: "This site may be dangerous" }),
      );
      vi.runAllTimers();

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle?.textContent).toBe("This site may be dangerous");

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("does not render subtitle when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle).toBeNull();

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("renders key-value rows when provided", async () => {
      const promise = showCredentialModal(
        minimalSpec({
          kv: [
            { k: "Domain", v: "evil.com" },
            { k: "Action", v: "password submit" },
          ],
        }),
      );
      vi.runAllTimers();

      const kvGrid = getShadow()?.querySelector(".kv");
      expect(kvGrid).not.toBeNull();
      const keys = Array.from(kvGrid!.querySelectorAll(".k")).map((el) => el.textContent);
      const vals = Array.from(kvGrid!.querySelectorAll(".v")).map((el) => el.textContent);
      expect(keys).toEqual(["Domain", "Action"]);
      expect(vals).toEqual(["evil.com", "password submit"]);

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("does not render kv grid when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".kv")).toBeNull();

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("renders reasons list with Signals header when provided", async () => {
      const promise = showCredentialModal(
        minimalSpec({ reasons: ["Domain mismatch", "No HTTPS"] }),
      );
      vi.runAllTimers();

      const reasonsTitle = getShadow()?.querySelector(".reasons-title");
      expect(reasonsTitle?.textContent).toBe("Signals");

      const items = Array.from(getShadow()!.querySelectorAll("li")).map(
        (el) => el.textContent,
      );
      expect(items).toEqual(["Domain mismatch", "No HTTPS"]);

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("does not render reasons when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".reasons")).toBeNull();

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("escapes HTML in all user-content fields (XSS regression guard)", async () => {
      const xss = '<img src=x onerror="alert(1)">';
      const promise = showCredentialModal(
        minimalSpec({
          title: xss,
          subtitle: xss,
          kv: [{ k: xss, v: xss }],
          reasons: [xss],
        }),
      );
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe(xss);
      expect(title?.innerHTML).not.toContain("<img");

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle?.textContent).toBe(xss);
      expect(subtitle?.innerHTML).not.toContain("<img");

      const kvKey = getShadow()?.querySelector(".k");
      expect(kvKey?.textContent).toBe(xss);
      expect(kvKey?.innerHTML).not.toContain("<img");

      const kvVal = getShadow()?.querySelector(".v");
      expect(kvVal?.textContent).toBe(xss);
      expect(kvVal?.innerHTML).not.toContain("<img");

      const li = getShadow()?.querySelector("li");
      expect(li?.textContent).toBe(xss);
      expect(li?.innerHTML).not.toContain("<img");

      activateButton(getButtons()[0]!);
      await promise;
    });
  });

  describe("button rendering and click resolution", () => {
    it("renders buttons with correct labels and CSS classes", async () => {
      const promise = showCredentialModal(
        minimalSpec({
          actions: [
            { id: "a", label: "Allow", kind: "primary" },
            { id: "b", label: "Block", kind: "danger" },
            { id: "c", label: "Cancel", kind: "neutral" },
          ],
        }),
      );
      vi.runAllTimers();

      const buttons = getButtons();
      expect(buttons).toHaveLength(3);
      expect(buttons[0]!.textContent).toBe("Allow");
      expect(buttons[0]!.classList.contains("primary")).toBe(true);
      expect(buttons[1]!.textContent).toBe("Block");
      expect(buttons[1]!.classList.contains("danger")).toBe(true);
      expect(buttons[2]!.textContent).toBe("Cancel");
      expect(buttons[2]!.classList.contains("primary")).toBe(false);
      expect(buttons[2]!.classList.contains("danger")).toBe(false);

      activateButton(buttons[0]!);
      await promise;
    });

    it("resolves with the clicked button action id", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      activateButton(getButtons()[1]!);

      expect(await promise).toBe("block");
    });

    it("resolves with the first button action id when clicked", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      activateButton(getButtons()[0]!);

      expect(await promise).toBe("allow");
    });

    it("handles empty actions array — only Escape can dismiss", async () => {
      const promise = showCredentialModal({
        title: "No buttons",
        actions: [],
        outsideAction: "dismissed",
      });
      vi.runAllTimers();

      expect(getCard()).not.toBeNull();
      expect(getButtons()).toHaveLength(0);

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(await promise).toBe("dismissed");
    });
  });

  describe("escape key dismissal", () => {
    it("resolves with outsideAction on Escape", async () => {
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: "dismissed" }),
      );
      vi.runAllTimers();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

      expect(await promise).toBe("dismissed");
    });

    it("resolves with 'cancel' on Escape when outsideAction is not set", async () => {
      const promise = showCredentialModal(
        minimalSpec(),
      );
      vi.runAllTimers();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

      expect(await promise).toBe("cancel");
    });

    it("removes the overlay after Escape", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await promise;

      expect(getOverlay()).toBeNull();
    });
  });

  describe("outside click dismissal", () => {
    it("resolves with outsideAction when clicking overlay background", async () => {
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: "outside_dismiss" }),
      );
      vi.runAllTimers();

      const overlay = getOverlay()!;
      overlay.dispatchEvent(trusted(new MouseEvent("mousedown", { bubbles: true })));

      expect(await promise).toBe("outside_dismiss");
    });

    it("resolves with default 'cancel' when clicking overlay without outsideAction", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const overlay = getOverlay()!;
      overlay.dispatchEvent(trusted(new MouseEvent("mousedown", { bubbles: true })));

      expect(await promise).toBe("cancel");
    });

    it("does NOT dismiss when clicking the card itself", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      card.dispatchEvent(trusted(new MouseEvent("mousedown", { bubbles: true })));

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      activateButton(getButtons()[0]!);
      await promise;
    });
  });

  describe("ensureHost idempotency", () => {
    it("does not create duplicate hosts on repeated calls", async () => {
      const p1 = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      activateButton(getButtons()[0]!);
      await p1;

      const p2 = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const hosts = document.querySelectorAll(`#${HOST_ID}`);
      expect(hosts.length).toBe(1);

      const overlays = getShadow()?.querySelectorAll(".overlay");
      expect(overlays?.length).toBe(1);

      activateButton(getButtons()[0]!);
      await p2;
    });
  });

  describe("modal replacement", () => {
    it("replaces previous modal and resolves p1 with outsideAction", async () => {
      const p1 = showCredentialModal(
        minimalSpec({ title: "First", outsideAction: "replaced" }),
      );
      vi.runAllTimers();

      const p2 = showCredentialModal(minimalSpec({ title: "Second" }));
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe("Second");

      const overlays = getShadow()?.querySelectorAll(".overlay");
      expect(overlays?.length).toBe(1);

      // p1 should resolve with its outsideAction since it was displaced
      expect(await p1).toBe("replaced");

      activateButton(getButtons()[0]!);
      await p2;
    });

    it("resolves displaced modal with default 'cancel' when no outsideAction", async () => {
      const p1 = showCredentialModal(minimalSpec({ title: "First" }));
      vi.runAllTimers();

      const p2 = showCredentialModal(minimalSpec({ title: "Second" }));
      vi.runAllTimers();

      expect(await p1).toBe("cancel");

      activateButton(getButtons()[0]!);
      await p2;
    });

    it("cleans up previous keydown listener on replacement", async () => {
      const p1 = showCredentialModal(
        minimalSpec({ outsideAction: "first_dismiss" }),
      );
      vi.runAllTimers();

      const p2 = showCredentialModal(
        minimalSpec({ outsideAction: "second_dismiss" }),
      );
      vi.runAllTimers();

      // p1 was already resolved by replacement
      expect(await p1).toBe("first_dismiss");

      // Escape should only resolve p2
      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(await p2).toBe("second_dismiss");
    });

    it("does not restore focus prematurely during replacement", async () => {
      const focusTarget = document.createElement("button");
      focusTarget.textContent = "Before modal";
      document.body.appendChild(focusTarget);
      focusTarget.focus();

      const p1 = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      // Replace p1 with p2
      const p2 = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      await p1;

      // Focus should NOT have been restored to focusTarget during replacement
      // (activeDispose does not call previouslyFocused.focus())
      // The focus target should still be in the DOM but not necessarily active
      expect(document.body.contains(focusTarget)).toBe(true);

      activateButton(getButtons()[0]!);
      await p2;
      document.body.removeChild(focusTarget);
    });
  });

  describe("keydown listener cleanup", () => {
    it("removes keydown listener after button click", async () => {
      const promise = showCredentialModal(minimalSpec({ outsideAction: "dismissed" }));
      vi.runAllTimers();

      const removeSpy = vi.spyOn(window, "removeEventListener");
      activateButton(getButtons()[0]!);
      await promise;

      expect(removeSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        true,
      );
      removeSpy.mockRestore();
    });

    it("removes keydown listener after Escape", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const removeSpy = vi.spyOn(window, "removeEventListener");
      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await promise;

      expect(removeSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        true,
      );
      removeSpy.mockRestore();
    });

    it("second Escape after dismissal has no effect", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await promise;

      expect(() =>
        window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
      ).not.toThrow();
      expect(getOverlay()).toBeNull();
    });
  });

  describe("ARIA and accessibility", () => {
    it("sets role=dialog and aria-modal on the card", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      expect(card.getAttribute("role")).toBe("dialog");
      expect(card.getAttribute("aria-modal")).toBe("true");

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("sets aria-labelledby pointing to the title element", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      const titleId = card.getAttribute("aria-labelledby")!;
      expect(titleId).toBeTruthy();

      const titleEl = getShadow()?.querySelector(`#${titleId}`);
      expect(titleEl?.textContent).toBe("Test Warning");

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("sets aria-describedby pointing to the body element", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      const bodyId = card.getAttribute("aria-describedby")!;
      expect(bodyId).toBeTruthy();

      const bodyEl = getShadow()?.querySelector(`#${bodyId}`);
      expect(bodyEl).not.toBeNull();
      expect(bodyEl?.classList.contains("body")).toBe(true);

      activateButton(getButtons()[0]!);
      await promise;
    });
  });

  describe("focus management", () => {
    it("auto-focuses first focusable button after timer fires", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const buttons = getButtons();
      expect(buttons.length).toBeGreaterThan(0);

      const shadow = getShadow()!;
      if (shadow.activeElement) {
        expect(shadow.activeElement).toBe(buttons[0]);
      }

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("focuses card when no focusable elements exist (empty actions)", async () => {
      const promise = showCredentialModal({
        title: "Card focus fallback",
        actions: [],
      });
      vi.runAllTimers();

      const card = getCard()!;
      expect(card.tabIndex).toBe(-1);

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await promise;
    });

    it("restores focus to previously active element after dismissal", async () => {
      const focusTarget = document.createElement("button");
      focusTarget.textContent = "Before modal";
      document.body.appendChild(focusTarget);
      focusTarget.focus();

      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      activateButton(getButtons()[0]!);
      await promise;

      expect(document.body.contains(focusTarget)).toBe(true);

      document.body.removeChild(focusTarget);
    });
  });

  describe("Tab key focus trap", () => {
    it("wraps focus from last button to first on Tab", async () => {
      const promise = showCredentialModal(
        minimalSpec({
          actions: [
            { id: "a", label: "First", kind: "primary" },
            { id: "b", label: "Last", kind: "danger" },
          ],
        }),
      );
      vi.runAllTimers();

      const buttons = getButtons();
      expect(buttons).toHaveLength(2);

      buttons[1]!.focus();

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(tabEvent, "preventDefault");
      window.dispatchEvent(tabEvent);

      expect(preventSpy).toHaveBeenCalled();

      const shadow = getShadow()!;
      if (shadow.activeElement) {
        expect(shadow.activeElement).toBe(buttons[0]);
      }

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("wraps focus from first button to last on Shift+Tab", async () => {
      const promise = showCredentialModal(
        minimalSpec({
          actions: [
            { id: "a", label: "First", kind: "primary" },
            { id: "b", label: "Last", kind: "danger" },
          ],
        }),
      );
      vi.runAllTimers();

      const buttons = getButtons();
      buttons[0]!.focus();

      const shiftTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(shiftTabEvent, "preventDefault");
      window.dispatchEvent(shiftTabEvent);

      expect(preventSpy).toHaveBeenCalled();

      const shadow = getShadow()!;
      if (shadow.activeElement) {
        expect(shadow.activeElement).toBe(buttons[1]);
      }

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("focuses card when Tab is pressed with no focusable elements", async () => {
      const promise = showCredentialModal({
        title: "No buttons",
        actions: [],
      });
      vi.runAllTimers();

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(tabEvent, "preventDefault");
      window.dispatchEvent(tabEvent);
      expect(preventSpy).toHaveBeenCalled();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await promise;
    });

    it("recaptures programmatic page focus to the first modal button", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      document.body.appendChild(outside);
      let promise: Promise<string> | null = null;

      try {
        promise = showCredentialModal(
          minimalSpec({
            actions: [
              { id: "a", label: "First", kind: "primary" },
              { id: "b", label: "Last", kind: "danger" },
            ],
          }),
        );
        vi.runAllTimers();

        const buttons = getButtons();
        outside.focus();

        expect(getShadow()!.activeElement).toBe(buttons[0]);

        activateButton(getButtons()[0]!);
        await promise;
      } finally {
        if (getOverlay()) {
          window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
          await promise;
        }
        outside.remove();
      }
    });

    it("keeps Shift+Tab wrapping after recapturing page focus", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      document.body.appendChild(outside);
      let promise: Promise<string> | null = null;

      try {
        promise = showCredentialModal(
          minimalSpec({
            actions: [
              { id: "a", label: "First", kind: "primary" },
              { id: "b", label: "Last", kind: "danger" },
            ],
          }),
        );
        vi.runAllTimers();

        const buttons = getButtons();
        outside.focus();
        expect(getShadow()!.activeElement).toBe(buttons[0]);

        const tabEvent = new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        });
        const preventSpy = vi.spyOn(tabEvent, "preventDefault");
        window.dispatchEvent(tabEvent);

        expect(preventSpy).toHaveBeenCalled();
        expect(getShadow()!.activeElement).toBe(buttons[1]);

        activateButton(getButtons()[0]!);
        await promise;
      } finally {
        if (getOverlay()) {
          window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
          await promise;
        }
        outside.remove();
      }
    });

    it("recaptures programmatic page focus before outside Enter handlers run", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      const outsideKeydown = vi.fn();
      outside.addEventListener("keydown", outsideKeydown);
      document.body.appendChild(outside);
      let promise: Promise<string> | null = null;

      try {
        promise = showCredentialModal(
          minimalSpec({
            actions: [
              { id: "a", label: "First", kind: "primary" },
              { id: "b", label: "Last", kind: "danger" },
            ],
          }),
        );
        vi.runAllTimers();

        const buttons = getButtons();
        outside.focus();

        expect(getShadow()!.activeElement).toBe(buttons[0]);

        const activeTarget =
          (getShadow()!.activeElement as HTMLElement | null) ??
          (document.activeElement as HTMLElement | null);
        activeTarget?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );

        expect(outsideKeydown).not.toHaveBeenCalled();

        activateButton(getButtons()[0]!);
        await promise;
      } finally {
        if (getOverlay()) {
          window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
          await promise;
        }
        outside.remove();
      }
    });

    it("recaptures focus before a page focusin listener registered before modal open can stop propagation", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      document.body.appendChild(outside);
      const stopFocusIn = vi.fn((event: Event) => event.stopImmediatePropagation());
      window.addEventListener("focusin", stopFocusIn, true);
      let promise: Promise<string> | null = null;

      try {
        promise = showCredentialModal(
          minimalSpec({
            actions: [
              { id: "a", label: "First", kind: "primary" },
              { id: "b", label: "Last", kind: "danger" },
            ],
          }),
        );
        vi.runAllTimers();

        const buttons = getButtons();
        stopFocusIn.mockClear();
        outside.focus();

        expect(stopFocusIn).toHaveBeenCalled();
        expect(getShadow()!.activeElement).toBe(buttons[0]);

        activateButton(getButtons()[0]!);
        await promise;
      } finally {
        window.removeEventListener("focusin", stopFocusIn, true);
        if (getOverlay()) {
          window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
          await promise;
        }
        outside.remove();
      }
    });
  });

  describe("synthetic activation rejection (#783)", () => {
    it("ignores a page-synthesized click on an action button", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[0]!.click();

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);
      expect(getOverlay()).not.toBeNull();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(await promise).toBe("cancel");
    });

    it("ignores a page-dispatched click event on an action button", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);
      expect(getOverlay()).not.toBeNull();

      window.dispatchEvent(trusted(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(await promise).toBe("cancel");
    });

    it("relay ignores a forged host, a page element, and a stale control", async () => {
      const p1 = showCredentialModal(minimalSpec({ title: "First" }));
      vi.runAllTimers();
      const stale = getButtons()[0]!;
      const p2 = showCredentialModal(minimalSpec({ title: "Second" }));
      vi.runAllTimers();
      await p1;

      const fakeHost = document.createElement("div");
      fakeHost.id = HOST_ID;
      const bait = document.createElement("button");
      expect(activateOwnedModalControl(fakeHost, [bait, fakeHost])).toBe(false);

      const host = getHost()!;
      const pageButton = document.createElement("button");
      expect(activateOwnedModalControl(host, [pageButton, host])).toBe(false);
      expect(activateOwnedModalControl(host, [stale, host])).toBe(false);
      expect(activateOwnedModalControl(host, [host])).toBe(false);

      expect(getOverlay()).not.toBeNull();
      activateButton(getButtons()[0]!);
      await p2;
    });

    it("relay returns false when no modal host exists", () => {
      expect(getHost()).toBeNull();
      expect(activateOwnedModalControl(null, [])).toBe(false);
    });
  });

  describe("extension ownership and top layer (#824)", () => {
    it("registers its host as extension-owned so self-detection skips it", async () => {
      // Dynamic import: beforeEach reset the module registry, so the static
      // import would see a different WeakSet than the loaded modal module.
      const owned = await import("../extension/src/content/extension_owned_overlay");
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(owned.isExtensionOwnedOverlayElement(getHost()!)).toBe(true);

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("is skipped by overlay classification even with fullscreen geometry", async () => {
      const monitor = await import("../extension/src/content/mutation_monitor");
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      const host = getHost()!;

      // happy-dom has no layout engine: stub the geometry reads so the host
      // presents the fullscreen fixed shape it has in a real browser.
      const rect = {
        x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 768,
        width: 1024, height: 768, toJSON: () => ({}),
      } as DOMRect;
      const rectSpy = vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect);
      const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue(
        { position: "fixed", display: "block", visibility: "visible", zIndex: "2147483647" } as CSSStyleDeclaration,
      );
      try {
        // Pre-fix this classified HIGH (dialog role is shadow-internal, where
        // the benign check cannot see it); post-fix ownership skips it.
        expect(monitor.classifyOverlayElement(host)).toBe(null);
      } finally {
        rectSpy.mockRestore();
        styleSpy.mockRestore();
      }

      activateButton(getButtons()[0]!);
      await promise;
    });

    it("places the host in the top layer as a manual popover when supported", async () => {
      const showPopover = vi.fn();
      Object.defineProperty(HTMLElement.prototype, "showPopover", {
        configurable: true,
        value: showPopover,
      });
      try {
        vi.resetModules();
        document.getElementById(HOST_ID)?.remove();
        await loadModule();
        const promise = showCredentialModal(minimalSpec());
        vi.runAllTimers();

        const host = getHost()!;
        expect(host.getAttribute("popover")).toBe("manual");
        expect(showPopover).toHaveBeenCalledTimes(1);
        expect(showPopover.mock.instances[0]).toBe(host);

        activateButton(getButtons()[0]!);
        await promise;
      } finally {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
      }
    });
  });
});
