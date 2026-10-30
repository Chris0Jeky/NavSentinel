import { DBLCLICK_WINDOW_MS } from "../shared/doubleclick_timing";

/** A control smaller than this in either CSS dimension is not a readable approval (#1142). */
const MIN_CONTROL_PX = 10;

// Focus state per frame load, not per prompt (#1236). A subframe's hasFocus() is also
// false while focus is elsewhere in the same tab, which would leave a toast in a
// never-clicked frame (a cleanup chip in an ad frame) unable to arm before its first
// click, so subframes require focus once the frame has had it (#1225). A frame that
// had focus earlier must not arm a later prompt behind a popup that holds it now.
let hadFocus = window.top === window || document.hasFocus();
// When this frame last lost or regained window focus. A blur shorter than a sample
// interval (a click on a covering popup or PiP window) still restarts arming.
let unfocusedAt = -Infinity;
let away = false;
function focusChange(event: Event): void {
  if (event.target instanceof Node) return; // An element's focus or blur, not the window's.
  hadFocus = true;
  // Chrome also blurs the window when focus moves into a child frame, while
  // hasFocus() stays true: that is not a loss and must not de-arm.
  if (event.type === "blur") away = !document.hasFocus();
  if (away) unfocusedAt = performance.now();
  if (event.type === "focus") away = false;
}
window.addEventListener("blur", focusChange, true);
window.addEventListener("focus", focusChange, true);

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
  // checks below stand alone, with the #1142 residuals they cannot see. Top frame
  // only: Chrome judges a cross-site iframe's occlusion for the whole frame box, so
  // any parent element over one corner (a sticky header, a cookie bar) would keep an
  // embedded login's approvals from ever arming (#1214 review). Subframe prompts keep
  // the explicit checks; the parent-fade residual stays tracked in #1149.
  if (!paint?.trackVisibility || window.top !== window) {
    paint?.disconnect();
    paint = null;
  }
  // Buttons only, not the whole card: our own toast can overlap a card corner on
  // small windows, and the card centre keeps its hit test below.

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
    // No observer sees another window over ours: a page popup placed over an
    // approval can take the arming window and close on the first press (#1225).
    // Residual: a subframe surface that never had focus arms without it.
    const focused = document.hasFocus();
    hadFocus ||= focused;
    if (hadFocus && !focused) unfocusedAt = performance.now();
    // Video and Document Picture-in-Picture windows stay on top of ours without
    // taking focus, by default over the corner where the toast sits (#1236).
    // Residual: Chrome's native <select>, date and colour pickers neither blur
    // the window nor change hasFocus(), so they stay undetectable here.
    if ((hadFocus && !focused) || document.pictureInPictureElement ||
        (window as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window ||
        !topLayer() || !rendered(host) || !rendered(surface)) return false;
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

  return {
    accepts(button: HTMLElement, event?: MouseEvent | KeyboardEvent): boolean {
      sample();
      const now = performance.now();
      const exposure = buttonExposure.get(button);
      // A button the browser never reported painted-visible is never armed.
      let allowed = !disposed && !!event && visibleSince !== null &&
        now - visibleSince >= DBLCLICK_WINDOW_MS && exposure !== undefined &&
        now - exposure.since >= DBLCLICK_WINDOW_MS && now - unfocusedAt >= DBLCLICK_WINDOW_MS && rendered(button) &&
        (!paint || now - (painted.get(button) ?? now) >= DBLCLICK_WINDOW_MS);
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
