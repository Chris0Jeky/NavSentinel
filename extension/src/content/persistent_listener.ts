/**
 * #1105: `document.open()` runs the HTML "document open steps", which erase
 * every event listener on the document, its descendants and the window, in
 * every world. A page that rewrites itself with
 * `document.open(); document.write(<form>); document.close()` therefore strips a
 * content script's capture listeners. A MutationObserver is not an event
 * listener and survives, so one shared observer on `document` re-adds ours.
 */
type Registration = { target: EventTarget; type: string; listener: EventListener; capture: boolean };

const registrations: Registration[] = [];
let observer: MutationObserver | null = null;

function register(r: Registration): void {
  // Remove-then-add with the same function and capture flag is idempotent.
  r.target.removeEventListener(r.type, r.listener, r.capture);
  r.target.addEventListener(r.type, r.listener, r.capture);
}

/**
 * Add a listener that is re-added whenever the document's children are
 * replaced. The observer callback is O(records) and does nothing unless a
 * child was removed, which on ordinary pages never happens after parsing.
 */
export function addPersistentListener(
  target: EventTarget,
  type: string,
  listener: EventListener,
  capture = true,
): void {
  const r: Registration = { target, type, listener, capture };
  registrations.push(r);
  register(r);
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.removedNodes.length === 0) continue;
      for (const reg of registrations) register(reg);
      return;
    }
  });
  observer.observe(document, { childList: true });
}
