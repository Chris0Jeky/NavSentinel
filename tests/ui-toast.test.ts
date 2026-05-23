// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ShowToastType = typeof import("../extension/src/content/ui_toast").showToast;

let showToast: ShowToastType;

async function loadModule(): Promise<void> {
  const mod = await import("../extension/src/content/ui_toast");
  showToast = mod.showToast;
}

describe("ui_toast", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.documentElement.querySelectorAll("#__navsentinel_toast_host").forEach((n) => n.remove());
    await loadModule();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.querySelectorAll("#__navsentinel_toast_host").forEach((n) => n.remove());
    document.body.innerHTML = "";
  });

  function getHost(): HTMLElement | null {
    return document.documentElement.querySelector("#__navsentinel_toast_host");
  }

  function getRoot(): ShadowRoot | null {
    return getHost()?.shadowRoot ?? null;
  }

  function getWraps(): NodeListOf<Element> {
    return getRoot()?.querySelectorAll(".wrap") ?? ([] as unknown as NodeListOf<Element>);
  }

  function getWrap(): Element | null {
    return getRoot()?.querySelector(".wrap") ?? null;
  }

  function getButtons(): HTMLButtonElement[] {
    const wrap = getWrap();
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll("button"));
  }

  describe("host and shadow DOM setup", () => {
    it("creates host element on first showToast call", () => {
      expect(getHost()).toBeNull();
      showToast({ message: "Test" });
      expect(getHost()).not.toBeNull();
      expect(getHost()!.id).toBe("__navsentinel_toast_host");
    });

    it("creates shadow root in open mode", () => {
      showToast({ message: "Test" });
      expect(getRoot()).not.toBeNull();
    });

    it("host has fixed positioning at bottom-right with max z-index", () => {
      showToast({ message: "Test" });
      const h = getHost()!;
      expect(h.style.position).toBe("fixed");
      expect(h.style.right).toBe("16px");
      expect(h.style.bottom).toBe("16px");
      expect(h.style.zIndex).toBe("2147483647");
    });

    it("injects stylesheet into shadow root", () => {
      showToast({ message: "Test" });
      const styles = getRoot()!.querySelectorAll("style");
      expect(styles.length).toBe(1);
      expect(styles[0]!.textContent).toContain(".wrap");
    });

    it("reuses host on subsequent calls (idempotent)", () => {
      showToast({ message: "First" });
      const firstHost = getHost();
      showToast({ message: "Second" });
      const secondHost = getHost();
      expect(firstHost).toBe(secondHost);
    });

    it("only has one style element after multiple calls", () => {
      showToast({ message: "First" });
      showToast({ message: "Second" });
      showToast({ message: "Third" });
      const styles = getRoot()!.querySelectorAll("style");
      expect(styles.length).toBe(1);
    });
  });

  describe("toast rendering", () => {
    it("renders wrap with role=alert", () => {
      showToast({ message: "Alert message" });
      const wrap = getWrap();
      expect(wrap).not.toBeNull();
      expect(wrap!.getAttribute("role")).toBe("alert");
    });

    it("displays the message text in the body", () => {
      showToast({ message: "Password field detected" });
      const body = getWrap()!.querySelector(".body");
      expect(body).not.toBeNull();
      expect(body!.textContent).toBe("Password field detected");
    });

    it("renders NavSentinel label in header", () => {
      showToast({ message: "Test" });
      const label = getWrap()!.querySelector(".head-label");
      expect(label).not.toBeNull();
      expect(label!.textContent).toBe("NavSentinel");
    });

    it("renders pulsing dot in header", () => {
      showToast({ message: "Test" });
      const dot = getWrap()!.querySelector(".head-dot");
      expect(dot).not.toBeNull();
    });

    it("always renders a Dismiss button", () => {
      showToast({ message: "Test" });
      const buttons = getButtons();
      const dismissBtn = buttons.find((b) => b.textContent === "Dismiss");
      expect(dismissBtn).toBeDefined();
      expect(dismissBtn!.classList.contains("danger")).toBe(true);
    });

    it("sets message via textContent, not innerHTML (XSS-safe)", () => {
      showToast({ message: "<script>alert(1)</script>" });
      const body = getWrap()!.querySelector(".body");
      expect(body!.textContent).toBe("<script>alert(1)</script>");
      expect(body!.innerHTML).not.toContain("<script>");
    });

    it("replaces previous toast when showing a new one", () => {
      showToast({ message: "First" });
      expect(getWraps().length).toBe(1);
      showToast({ message: "Second" });
      expect(getWraps().length).toBe(1);
      expect(getWrap()!.querySelector(".body")!.textContent).toBe("Second");
    });
  });

  describe("action buttons", () => {
    it("renders action buttons with correct labels", () => {
      showToast({
        message: "Test",
        actions: [
          { label: "Trust site", onClick: vi.fn() },
          { label: "Details", onClick: vi.fn() },
        ],
      });
      const buttons = getButtons();
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain("Trust site");
      expect(labels).toContain("Details");
    });

    it("action buttons have the action class", () => {
      showToast({
        message: "Test",
        actions: [{ label: "Trust", onClick: vi.fn() }],
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust");
      expect(actionBtn!.classList.contains("action")).toBe(true);
    });

    it("calls onClick when action button is clicked", () => {
      const onClick = vi.fn();
      showToast({
        message: "Test",
        actions: [{ label: "Trust", onClick }],
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust")!;
      actionBtn.click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("removes toast after action button click", () => {
      showToast({
        message: "Test",
        actions: [{ label: "Trust", onClick: vi.fn() }],
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust")!;
      actionBtn.click();
      expect(getWraps().length).toBe(0);
    });

    it("removes toast even if onClick throws", () => {
      showToast({
        message: "Test",
        actions: [{
          label: "Trust",
          onClick: () => { throw new Error("callback error"); },
        }],
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust")!;
      expect(() => actionBtn.click()).toThrow("callback error");
      expect(getWraps().length).toBe(0);
    });

    it("renders no action buttons when actions is empty", () => {
      showToast({ message: "Test", actions: [] });
      const buttons = getButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.textContent).toBe("Dismiss");
    });

    it("renders no action buttons when actions is omitted", () => {
      showToast({ message: "Test" });
      const buttons = getButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.textContent).toBe("Dismiss");
    });

    it("Dismiss button is last in the row", () => {
      showToast({
        message: "Test",
        actions: [{ label: "Trust", onClick: vi.fn() }],
      });
      const buttons = getButtons();
      expect(buttons[buttons.length - 1]!.textContent).toBe("Dismiss");
    });
  });

  describe("dismiss behavior", () => {
    it("clicking Dismiss removes the toast", () => {
      showToast({ message: "Test" });
      const dismissBtn = getButtons().find((b) => b.textContent === "Dismiss")!;
      dismissBtn.click();
      expect(getWraps().length).toBe(0);
    });

    it("clicking Dismiss calls onDismiss callback", () => {
      const onDismiss = vi.fn();
      showToast({ message: "Test", onDismiss });
      const dismissBtn = getButtons().find((b) => b.textContent === "Dismiss")!;
      dismissBtn.click();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not call onDismiss if an action was clicked before dismiss", () => {
      const onDismiss = vi.fn();
      const onClick = vi.fn();
      showToast({
        message: "Test",
        actions: [{ label: "Trust", onClick }],
        onDismiss,
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust")!;
      actionBtn.click();
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe("auto-dismiss timeout", () => {
    it("auto-dismisses after default 4000ms", () => {
      showToast({ message: "Test" });
      expect(getWraps().length).toBe(1);

      vi.advanceTimersByTime(3999);
      expect(getWraps().length).toBe(1);

      vi.advanceTimersByTime(1);
      expect(getWraps().length).toBe(0);
    });

    it("uses custom timeoutMs when provided", () => {
      showToast({ message: "Test", timeoutMs: 10000 });
      vi.advanceTimersByTime(9999);
      expect(getWraps().length).toBe(1);

      vi.advanceTimersByTime(1);
      expect(getWraps().length).toBe(0);
    });

    it("calls onDismiss on auto-dismiss", () => {
      const onDismiss = vi.fn();
      showToast({ message: "Test", timeoutMs: 5000, onDismiss });

      vi.advanceTimersByTime(5000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not call onDismiss on auto-dismiss if action was clicked", () => {
      const onDismiss = vi.fn();
      showToast({
        message: "Test",
        timeoutMs: 5000,
        actions: [{ label: "Trust", onClick: vi.fn() }],
        onDismiss,
      });
      const actionBtn = getButtons().find((b) => b.textContent === "Trust")!;
      actionBtn.click();

      vi.advanceTimersByTime(5000);
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it("does not auto-dismiss if manually dismissed first", () => {
      const onDismiss = vi.fn();
      showToast({ message: "Test", timeoutMs: 5000, onDismiss });

      const dismissBtn = getButtons().find((b) => b.textContent === "Dismiss")!;
      dismissBtn.click();
      expect(onDismiss).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not auto-dismiss when timeoutMs is 0", () => {
      showToast({ message: "Test", timeoutMs: 0 });
      vi.advanceTimersByTime(100000);
      expect(getWraps().length).toBe(1);
    });

    it("does not auto-dismiss when timeoutMs is negative", () => {
      showToast({ message: "Test", timeoutMs: -1 });
      vi.advanceTimersByTime(100000);
      expect(getWraps().length).toBe(1);
    });
  });

  describe("toast replacement interaction with timeout", () => {
    it("replacing toast before timeout does not call onDismiss of replaced toast", () => {
      const onDismiss1 = vi.fn();
      showToast({ message: "First", timeoutMs: 5000, onDismiss: onDismiss1 });

      showToast({ message: "Second" });
      expect(onDismiss1).not.toHaveBeenCalled();

      vi.advanceTimersByTime(5000);
      expect(onDismiss1).not.toHaveBeenCalled();
    });
  });
});
