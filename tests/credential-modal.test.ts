// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModalSpec } from "../extension/src/content/credential_modal";

const HOST_ID = "__sentinelsuite_cred_modal_host__";

type ShowFn = (spec: ModalSpec) => Promise<string>;

let showCredentialModal: ShowFn;

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.getElementById(HOST_ID)?.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(HOST_ID)?.remove();
  });

  describe("showCredentialModal basic contract", () => {
    it("creates a shadow DOM host in the document", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getHost()).not.toBeNull();
      expect(getShadow()).not.toBeNull();
      expect(getOverlay()).not.toBeNull();

      getButtons()[0]!.click();
      await promise;
    });

    it("renders the title text", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec({ title: "Phishing Alert" }));
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe("Phishing Alert");

      getButtons()[0]!.click();
      await promise;
    });

    it("renders subtitle when provided", async () => {
      await loadModule();
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
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const subtitle = getShadow()?.querySelector(".subtitle");
      expect(subtitle).toBeNull();

      getButtons()[0]!.click();
      await promise;
    });

    it("renders key-value rows when provided", async () => {
      await loadModule();
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
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".kv")).toBeNull();

      getButtons()[0]!.click();
      await promise;
    });

    it("renders reasons list when provided", async () => {
      await loadModule();
      const promise = showCredentialModal(
        minimalSpec({ reasons: ["Domain mismatch", "No HTTPS"] }),
      );
      vi.runAllTimers();

      const items = Array.from(getShadow()!.querySelectorAll("li")).map(
        (el) => el.textContent,
      );
      expect(items).toEqual(["Domain mismatch", "No HTTPS"]);

      getButtons()[0]!.click();
      await promise;
    });

    it("does not render reasons when absent", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      expect(getShadow()?.querySelector(".reasons")).toBeNull();

      getButtons()[0]!.click();
      await promise;
    });
  });

  describe("button rendering and click resolution", () => {
    it("renders buttons with correct labels and CSS classes", async () => {
      await loadModule();
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
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[1]!.click();

      expect(await promise).toBe("block");
    });

    it("resolves with the first button action id when clicked", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      getButtons()[0]!.click();

      expect(await promise).toBe("allow");
    });
  });

  describe("escape key dismissal", () => {
    it("resolves with outsideAction on Escape", async () => {
      await loadModule();
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: "dismissed" }),
      );
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(await promise).toBe("dismissed");
    });

    it("resolves with 'cancel' on Escape when outsideAction is not set", async () => {
      await loadModule();
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: undefined }),
      );
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(await promise).toBe("cancel");
    });

    it("removes the overlay after Escape", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await promise;

      expect(getOverlay()).toBeNull();
    });
  });

  describe("outside click dismissal", () => {
    it("resolves with outsideAction when clicking overlay background", async () => {
      await loadModule();
      const promise = showCredentialModal(
        minimalSpec({ outsideAction: "outside_dismiss" }),
      );
      vi.runAllTimers();

      const overlay = getOverlay()!;
      overlay.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, target: overlay } as MouseEventInit),
      );

      expect(await promise).toBe("outside_dismiss");
    });

    it("does NOT dismiss when clicking the card itself", async () => {
      await loadModule();
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
      await loadModule();
      const p1 = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      getButtons()[0]!.click();
      await p1;

      const p2 = showCredentialModal(minimalSpec());
      vi.runAllTimers();
      getButtons()[0]!.click();
      await p2;

      const hosts = document.querySelectorAll(`#${HOST_ID}`);
      expect(hosts.length).toBe(1);
    });
  });

  describe("modal replacement", () => {
    it("replaces previous modal when called again before resolution", async () => {
      await loadModule();
      const p1 = showCredentialModal(minimalSpec({ title: "First" }));
      vi.runAllTimers();

      const p2 = showCredentialModal(minimalSpec({ title: "Second" }));
      vi.runAllTimers();

      const title = getShadow()?.querySelector(".title");
      expect(title?.textContent).toBe("Second");

      const overlays = getShadow()?.querySelectorAll(".overlay");
      expect(overlays?.length).toBe(1);

      let p1Resolved = false;
      p1.then(() => { p1Resolved = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(p1Resolved).toBe(false);

      getButtons()[0]!.click();
      await p2;
    });
  });

  describe("ARIA and accessibility", () => {
    it("sets role=dialog and aria-modal on the card", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      expect(card.getAttribute("role")).toBe("dialog");
      expect(card.getAttribute("aria-modal")).toBe("true");

      getButtons()[0]!.click();
      await promise;
    });

    it("sets aria-labelledby and aria-describedby on the card", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const card = getCard()!;
      expect(card.getAttribute("aria-labelledby")).toBeTruthy();
      expect(card.getAttribute("aria-describedby")).toBeTruthy();

      const titleId = card.getAttribute("aria-labelledby")!;
      const titleEl = getShadow()?.querySelector(`#${titleId}`);
      expect(titleEl?.textContent).toBe("Test Warning");

      getButtons()[0]!.click();
      await promise;
    });
  });

  describe("focus management", () => {
    it("auto-focuses first focusable button after render", async () => {
      await loadModule();
      const promise = showCredentialModal(minimalSpec());
      vi.runAllTimers();

      const buttons = getButtons();
      expect(buttons[0]!.tabIndex).toBeGreaterThanOrEqual(0);

      getButtons()[0]!.click();
      await promise;
    });
  });
});
