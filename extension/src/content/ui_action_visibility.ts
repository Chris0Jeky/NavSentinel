import { DBLCLICK_WINDOW_MS } from "../shared/doubleclick_timing";

/** Security controls need a painted, unobscured exposure window, not just trusted input. */
export function visibleActionGate(host: HTMLElement, root: ShadowRoot, surface: HTMLElement) {
  let visibleSince: number | null = null;
  let lastFrame = performance.now();
  let frame = 0;
  let disposed = false;
  const buttonSince = new Map<HTMLElement, number>();

  function rendered(element: Element): boolean {
    if (!element.isConnected || document.visibilityState === "hidden") return false;
    if (typeof element.checkVisibility === "function" &&
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    // checkVisibility does not cover filters, masks, or clipping. Refuse these
    // page-controlled effects, including near-transparent ancestors, conservatively.
    for (let node: Element | null = element; node; node = node.parentElement ??
      (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)) {
      const css = getComputedStyle(node);
      if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse" ||
          (css.opacity !== "" && Number(css.opacity) < 0.99) ||
          (css.filter && css.filter !== "none") || (css.clipPath && css.clipPath !== "none") ||
          (css.clip && css.clip !== "auto") || (css.maskImage && css.maskImage !== "none")) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function topLayer(): boolean {
    return !("showPopover" in host) || host.matches(":popover-open");
  }

  function hit(element: HTMLElement, x: number, y: number): boolean {
    if (document.elementFromPoint(x, y) !== host) return false;
    const target = root.elementFromPoint(x, y);
    return target !== null && (target === element || element.contains(target));
  }

  function visible(): boolean {
    if (!topLayer() || !rendered(host) || !rendered(surface)) return false;
    const rect = surface.getBoundingClientRect();
    return hit(surface, rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  function sample(): void {
    if (observer.takeRecords().length) { visibleSince = null; buttonSince.clear(); }
    const now = performance.now();
    // Background tabs and stalled rendering cannot bank an exposure window.
    if (now - lastFrame > 100 || !visible()) visibleSince = null;
    else visibleSince ??= now;
    for (const button of Array.from(surface.querySelectorAll<HTMLElement>("button"))) {
      const rect = button.getBoundingClientRect();
      if (visibleSince === null || !rendered(button) ||
          !hit(button, rect.x + rect.width / 2, rect.y + rect.height / 2)) buttonSince.delete(button);
      else if (!buttonSince.has(button)) buttonSince.set(button, now);
    }
    lastFrame = now;
  }

  function tick(): void {
    if (disposed) return;
    sample();
    frame = requestAnimationFrame(tick);
  }

  // Catch hide/show mutations even if they happen between animation frames or
  // in an earlier listener of the very click being checked.
  const observer = new MutationObserver(() => { visibleSince = null; buttonSince.clear(); });
  for (let node: Element | null = host; node; node = node.parentElement) {
    observer.observe(node, { attributes: true });
  }
  observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true });
  sample();
  frame = requestAnimationFrame(tick);

  return {
    accepts(button: HTMLElement, event?: MouseEvent | KeyboardEvent): boolean {
      sample();
      let allowed = !disposed && !!event && visibleSince !== null &&
        performance.now() - visibleSince >= DBLCLICK_WINDOW_MS && buttonSince.has(button) &&
        performance.now() - buttonSince.get(button)! >= DBLCLICK_WINDOW_MS && rendered(button);
      if (allowed && event) {
        const rect = button.getBoundingClientRect();
        const keyboard = event instanceof KeyboardEvent || event.detail === 0;
        const x = keyboard ? rect.x + rect.width / 2 : event.clientX;
        const y = keyboard ? rect.y + rect.height / 2 : event.clientY;
        allowed = (!keyboard || root.activeElement === button) &&
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && hit(button, x, y);
      }
      if (!allowed) {
        visibleSince = null;
        buttonSince.clear();
        // Keep the decision pending and recover a detached/hidden top layer.
        if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
        try { if (!topLayer()) host.showPopover(); } catch { /* Re-arm once renderable. */ }
      }
      return allowed;
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };
}
