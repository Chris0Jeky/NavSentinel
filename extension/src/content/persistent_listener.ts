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
let rewritten = false;

/** #1113: true once a rewrite removed the document's root, after which page listeners can precede ours. */
export function documentRewritten(): boolean {
  return rewritten;
}

function register(r: Registration): void {
  // Adding the same function and capture flag again is a no-op that keeps its place,
  // so a page that adds a document child cannot move the guard behind its own listener.
  r.target.addEventListener(r.type, r.listener, r.capture);
}

/**
 * Add a listener that is re-added whenever the document's children are
 * changed. Document childList records come only from parsing the doctype and
 * root element and from rewrites, so ordinary pages see no callbacks after load.
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
    // Any childList record: document.open() on an already childless document
    // erases the listeners but queues only an addedNodes record.
    if (records.length > 0) for (const reg of registrations) register(reg);
    if (records.some((r) => r.removedNodes.length > 0)) rewritten = true;
  });
  observer.observe(document, { childList: true });
}
