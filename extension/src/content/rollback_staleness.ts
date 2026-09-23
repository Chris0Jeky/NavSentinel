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
 */
export function isStaleDelivery(messageUrl: string, currentHref: string): boolean {
  if (!messageUrl) return true;
  return stripUrlFragment(currentHref) !== stripUrlFragment(messageUrl);
}
