import { DBLCLICK_WINDOW_MS } from "../shared/doubleclick_timing";

/** A control smaller than this in either CSS dimension is not a readable approval (#1142). */
const MIN_CONTROL_PX = 10;

/** Security controls need a painted, unobscured exposure window, not just trusted input. */
export function visibleActionGate(host: HTMLElement, root: ShadowRoot, surface: HTMLElement) {
  let visibleSince: number | null = null;
  let lastFrame = performance.now();
  let frame = 0;
  let disposed = false;
  const buttonExposure = new Map<HTMLElement, { since: number; rect: DOMRect }>();
  // IntersectionObserver v2 reports the rendered result: occlusion by any later
  // top-layer or pointer-events:none cover, and opacity, transforms, filters and
  // blend modes on the target or its ancestors. The browser computes it in the
  // rendering update after the page's rAF callbacks, so a page cannot restore
  // the prompt only for our samples (#1142). Maps observed element -> visible since.
  // Residual: Chrome recomputes at most every `delay` ms between those updates.
  const painted = new Map<Element, number>();
  let paint: (IntersectionObserver & { trackVisibility?: boolean }) | null = null;
  try {
    paint = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!(entry as IntersectionObserverEntry & { isVisible?: boolean }).isVisible) painted.delete(entry.target);
        else if (!painted.has(entry.target)) painted.set(entry.target, entry.time);
      }
    }, { trackVisibility: true, delay: 100 } as IntersectionObserverInit);
  } catch { /* Fall back below. */ }
  // ponytail: without trackVisibility (Chromium builds lacking IO v2) the explicit
  // checks below stand alone, with the #1142 residuals they cannot see.
  if (!paint?.trackVisibility) {
    paint?.disconnect();
    paint = null;
  }
  paint?.observe(surface);

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
          (css.clip && css.clip !== "auto") || (css.maskImage && css.maskImage !== "none") ||
          (css.mixBlendMode && css.mixBlendMode !== "normal")) return false;
    }
    // getBoundingClientRect includes transforms and zoom, so this also refuses
    // a scaled-down host that checkVisibility still calls visible.
    const rect = element.getBoundingClientRect();
    return rect.width >= MIN_CONTROL_PX && rect.height >= MIN_CONTROL_PX;
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
    // Mutations request a fresh visibility check; unchanged visibility banks exposure.
    observer.takeRecords();
    const now = performance.now();
    // Background tabs and stalled rendering cannot bank an exposure window.
    if (now - lastFrame > 100 || !visible()) visibleSince = null;
    else visibleSince ??= now;
    for (const button of buttonExposure.keys()) {
      if (!surface.contains(button)) buttonExposure.delete(button);
    }
    for (const button of Array.from(surface.querySelectorAll<HTMLElement>("button"))) {
      paint?.observe(button); // No-op once observed.
      const rect = button.getBoundingClientRect();
      if (visibleSince === null || !rendered(button) ||
          !hit(button, rect.x + rect.width / 2, rect.y + rect.height / 2)) buttonExposure.delete(button);
      else {
        const exposure = buttonExposure.get(button);
        // Allow <=1 CSS px of jitter per component, measured from the arming box
        // so incremental movement cannot bank exposure at a new position or size.
        if (!exposure || (["x", "y", "width", "height"] as const)
          .some((field) => Math.abs(rect[field] - exposure.rect[field]) > 1)) {
          buttonExposure.set(button, { since: now, rect });
        }
      }
    }
  }

  function tick(): void {
    if (disposed) return;
    sample();
    // Mutation and input samples must not disguise a gap in animation frames.
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }

  // Recheck mutations between animation frames; accepts also samples synchronously
  // after any earlier listener of the very click being checked.
  const observer = new MutationObserver(sample);
  for (let node: Element | null = host; node; node = node.parentElement) {
    observer.observe(node, { attributes: true });
  }
  observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true });
  sample();
  frame = requestAnimationFrame(tick);

  // An element the browser has not reported painted-visible is never armed.
  const paintedFor = (element: Element, now: number) =>
    !paint || now - (painted.get(element) ?? now) >= DBLCLICK_WINDOW_MS;

  return {
    accepts(button: HTMLElement, event?: MouseEvent | KeyboardEvent): boolean {
      sample();
      const now = performance.now();
      const exposure = buttonExposure.get(button);
      let allowed = !disposed && !!event && visibleSince !== null &&
        now - visibleSince >= DBLCLICK_WINDOW_MS && exposure !== undefined &&
        now - exposure.since >= DBLCLICK_WINDOW_MS && rendered(button) &&
        paintedFor(surface, now) && paintedFor(button, now);
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
        buttonExposure.clear();
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
      paint?.disconnect();
    },
  };
}
