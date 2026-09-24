/**
 * Shared helpers for the page-injected UI acceptance procedures (AI-47 step 1,
 * AI-29 regression, AI-47 step 4). They only observe the page or deliver
 * trusted input; they never call into the extension.
 */
import { expect, type BrowserContext, type Frame, type Page } from "@playwright/test";

export type Scope = Page | Frame;

export const INPUT_EVENT_TYPES = [
  "pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup",
  "touchstart", "touchend", "touchcancel", "click", "dblclick", "auxclick",
  "contextmenu", "keydown", "keypress", "keyup",
] as const;

/**
 * Page-realm listeners at every level a page script can reach — window and
 * document capture, <html>/<body> bubble and window bubble — recording each
 * input event they observe. Calling it again only clears the record.
 */
export async function installPageInputCounter(scope: Scope): Promise<void> {
  await scope.evaluate((types) => {
    type State = { events: string[] };
    const holder = window as unknown as { __nsAccInput?: State };
    if (holder.__nsAccInput) {
      holder.__nsAccInput.events.length = 0;
      return;
    }
    const state: State = { events: [] };
    holder.__nsAccInput = state;
    const record = (where: string) => (event: Event) => {
      const key = event instanceof KeyboardEvent ? `(${event.key === " " ? "Space" : event.key})` : "";
      state.events.push(`${where}:${event.type}${key}:${event.isTrusted ? "trusted" : "synthetic"}`);
    };
    for (const type of types) {
      window.addEventListener(type, record("window-capture"), { capture: true });
      document.addEventListener(type, record("document-capture"), { capture: true });
      document.documentElement.addEventListener(type, record("html-bubble"));
      document.body?.addEventListener(type, record("body-bubble"));
      window.addEventListener(type, record("window-bubble"));
    }
  }, [...INPUT_EVENT_TYPES]);
}

export async function readPageInputEvents(scope: Scope): Promise<string[]> {
  return scope.evaluate(() => [...((window as unknown as { __nsAccInput?: { events: string[] } }).__nsAccInput?.events ?? [])]);
}

export type ToastCard = { text: string; persistent: boolean; brief: boolean; buttons: string[] };

/** Every card under every element carrying the host id, so a forged host cannot mask the real one. */
export async function toastCards(scope: Scope): Promise<ToastCard[]> {
  return scope.evaluate(() => Array.from(document.querySelectorAll("#__navsentinel_toast_host")).flatMap((host) =>
    Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>(".wrap") ?? []).map((card) => ({
      text: card.querySelector(".body")?.textContent?.trim() ?? "",
      persistent: card.dataset.persistent === "true",
      brief: card.classList.contains("brief-recovery"),
      buttons: Array.from(card.querySelectorAll("button"), (button) => button.textContent?.trim() ?? ""),
    }))));
}

export async function fullCardCount(scope: Scope): Promise<number> {
  return (await toastCards(scope)).filter((card) => !card.persistent).length;
}

export async function briefCardCount(scope: Scope): Promise<number> {
  return (await toastCards(scope)).filter((card) => card.brief).length;
}

/**
 * Main-viewport centre of an extension-owned toast button (works inside child
 * frames: Playwright reports frame content boxes in top-level coordinates).
 */
export async function toastButtonCenter(scope: Scope, label: string, kind: "full" | "brief" | "any" = "any"): Promise<{ x: number; y: number }> {
  const cardSelector = kind === "full"
    ? "#__navsentinel_toast_host .wrap:not([data-persistent='true'])"
    : kind === "brief" ? "#__navsentinel_toast_host .wrap.brief-recovery" : "#__navsentinel_toast_host .wrap";
  const button = scope.locator(cardSelector).getByRole("button", { name: label, exact: true }).first();
  const box = await button.boundingBox();
  if (!box) throw new Error(`toast button "${label}" (${kind}) is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One trusted mouse click on an extension-owned toast button. */
export async function clickToastButton(page: Page, scope: Scope, label: string, kind: "full" | "brief" | "any" = "any"): Promise<void> {
  const point = await toastButtonCenter(scope, label, kind);
  await page.mouse.click(point.x, point.y);
}

/** Label of the toast button holding focus in this document, if focus is inside the real host. */
export async function focusedToastButton(scope: Scope): Promise<string | null> {
  return scope.evaluate(() => {
    const active = document.activeElement;
    if (!active || active.id !== "__navsentinel_toast_host") return null;
    return active.shadowRoot?.activeElement?.textContent?.trim() ?? null;
  });
}

/**
 * Move focus with real Tab key presses until the named toast button is focused.
 * Starts from the document (blurs the current element) so the walk is
 * deterministic. Returns the number of Tab presses it took, or -1.
 */
export async function tabToToastButton(page: Page, scope: Scope, label: string, maxPresses = 40): Promise<number> {
  await scope.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let presses = 1; presses <= maxPresses; presses += 1) {
    await page.keyboard.press("Tab");
    if (await focusedToastButton(scope) === label) return presses;
  }
  return -1;
}

export function openTabCount(context: BrowserContext): number {
  return context.pages().filter((page) => !page.isClosed()).length;
}

/** Resolves with the next page opened in the context, or null after `timeoutMs`. */
export function nextPage(context: BrowserContext, timeoutMs: number): Promise<Page | null> {
  return context.waitForEvent("page", { timeout: timeoutMs }).catch(() => null);
}

/** Computed visibility of an element by selector: null when absent. */
export async function elementVisibility(scope: Scope, selector: string): Promise<{ present: boolean; display: string | null; visible: boolean }> {
  return scope.evaluate((sel) => {
    const element = document.querySelector<HTMLElement>(sel);
    if (!element) return { present: false, display: null, visible: false };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      present: true,
      display: style.display,
      visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
    };
  }, selector);
}

export async function expectEventuallyHidden(scope: Scope, selector: string, timeoutMs: number, message: string): Promise<void> {
  await expect.poll(async () => {
    const state = await elementVisibility(scope, selector);
    return state.present && !state.visible;
  }, { timeout: timeoutMs, intervals: [50], message }).toBe(true);
}

/** What the top-level page would hit at a viewport point (the host id when the toast wins). */
export async function hitTargetId(page: Page, point: { x: number; y: number }): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element ? (element.id || element.tagName.toLowerCase()) : "none";
  }, point);
}
