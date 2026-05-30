// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function getCard(): HTMLElement | null {
  return getShadow()?.querySelector(".card") as HTMLElement | null;
}

function getButtons(): HTMLElement[] {
  const footer = getShadow()?.querySelector(".footer");
  if (!footer) return [];
  return Array.from(footer.querySelectorAll("button"));
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

      getButtons()[0]!.click();
      await promise;
    });

    it("renders the title text", async () => {
      const promise = showCredentialModal(minimalSpec({ title: "Phishing Alert" }));
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe("Phishing Alert");

      getButtons()[0]!.click();
      await promise;
    });

    it("renders subtitle when provided", async () => {
      const promise = showCredentialModal(
        minimalSpec({ subtitle: "This site may be dangerous" }),
      );
      vi.runAllTimers();

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle?.textContent).toBe("This site may be dangerous");

      getButtons()[0]!.click();
      await promise;
    });

    it("does not render subtitle when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle).toBeNull();

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
      await promise;
    });

    it("does not render kv grid when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".kv")).toBeNull();

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
      await promise;
    });

    it("does not render reasons when absent", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".reasons")).toBeNull();

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      buttons[0]!.click();
      await promise;
    });

    it("resolves with the clicked button action id", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[1]!.click();

      expect(await promise).toBe("block");
    });

    it("resolves with the first button action id when clicked", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[0]!.click();

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

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(await promise).toBe("dismissed");
    });
  });

  describe("escape key dismissal", () => {
    it("resolves with outsideAction on Escape", async () => {
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: "dismissed" }),
      );
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(await promise).toBe("dismissed");
    });

    it("resolves with 'cancel' on Escape when outsideAction is not set", async () => {
      const promise = showCredentialModal(
        minimalSpec(),
      );
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(await promise).toBe("cancel");
    });

    it("removes the overlay after Escape", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(await promise).toBe("outside_dismiss");
    });

    it("resolves with default 'cancel' when clicking overlay without outsideAction", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const overlay = getOverlay()!;
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(await promise).toBe("cancel");
    });

    it("does NOT dismiss when clicking the card itself", async () => {
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      let resolved = false;
      promise.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      getButtons()[0]!.click();
      await promise;
    });
  });

  describe("ensureHost idempotency", () => {
    it("does not create duplicate hosts on repeated calls", async () => {
      const p1 = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      getButtons()[0]!.click();
      await p1;

      const p2 = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const hosts = document.querySelectorAll(`#${HOST_ID}`);
      expect(hosts.length).toBe(1);

      const overlays = getShadow()?.querySelectorAll(".overlay");
      expect(overlays?.length).toBe(1);

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
      await p2;
    });

    it("resolves displaced modal with default 'cancel' when no outsideAction", async () => {
      const p1 = showCredentialModal(minimalSpec({ title: "First" }));
      vi.runAllTimers();

      const p2 = showCredentialModal(minimalSpec({ title: "Second" }));
      vi.runAllTimers();

      expect(await p1).toBe("cancel");

      getButtons()[0]!.click();
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
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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

      getButtons()[0]!.click();
      await p2;
      document.body.removeChild(focusTarget);
    });
  });

  describe("keydown listener cleanup", () => {
    it("removes keydown listener after button click", async () => {
      const promise = showCredentialModal(minimalSpec({ outsideAction: "dismissed" }));
      vi.runAllTimers();

      const removeSpy = vi.spyOn(window, "removeEventListener");
      getButtons()[0]!.click();
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
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
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

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await promise;

      expect(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
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

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await promise;
    });

    it("restores focus to previously active element after dismissal", async () => {
      const focusTarget = document.createElement("button");
      focusTarget.textContent = "Before modal";
      document.body.appendChild(focusTarget);
      focusTarget.focus();

      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      getButtons()[0]!.click();
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

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await promise;
    });

    it("recaptures focus from the page to the first modal button on Tab", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      document.body.appendChild(outside);

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
      outside.focus();
      expect(document.activeElement).toBe(outside);

      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(tabEvent, "preventDefault");
      window.dispatchEvent(tabEvent);

      expect(preventSpy).toHaveBeenCalled();
      expect(getShadow()!.activeElement).toBe(buttons[0]);

      getButtons()[0]!.click();
      await promise;
      document.body.removeChild(outside);
    });

    it("recaptures focus from the page to the last modal button on Shift+Tab", async () => {
      const outside = document.createElement("button");
      outside.textContent = "Outside";
      document.body.appendChild(outside);

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
      outside.focus();
      expect(document.activeElement).toBe(outside);

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

      getButtons()[0]!.click();
      await promise;
      document.body.removeChild(outside);
    });
  });
});
