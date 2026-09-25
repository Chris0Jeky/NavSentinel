/**
 * Staleness guards for rollback/forward delivery (#774).
 *
 * The SW-side rollback/forward bookkeeping is last-wins correct, but an
 * already-delivered message still executes in the tab: a stale in-flight
 * `ns-rollback` can double-navigate and strand the tab on the first bad page
 * with its forward offer lost. These pure helpers let the content side drop
 * deliveries the tab has moved on from.
 */

/** Strip the fragment so same-document anchor jumps compare equal. */
export function stripUrlFragment(href: string): string {
  const hash = href.indexOf("#");
  return hash >= 0 ? href.slice(0, hash) : href;
}

/**
 * True when the tab is no longer at the URL a rollback/forward message
 * targets. Comparison is fragment-stripped: fragment navigations fire
 * `onCommitted`, so a naive exact match would drop legitimate deliveries
 * after an in-page anchor jump. An empty target is always stale.
 *
 * When `committedHref` (the document's commit-time URL from NavigationTiming)
 * is provided, it — not the live href — is the comparison basis. Same-document
 * `pushState` rewrites `location.href` without a navigation, so a live-href
 * comparison lets a quiet query push void a legitimate rollback; the commit
 * entry is immune to that while real navigations (new document, new entry)
 * still compare stale. (#855)
 */
export function isStaleDelivery(
  messageUrl: string,
  currentHref: string,
  committedHref?: string,
): boolean {
  if (!messageUrl) return true;
  const basis = committedHref ? stripUrlFragment(committedHref) : stripUrlFragment(currentHref);
  return basis !== stripUrlFragment(messageUrl);
}
