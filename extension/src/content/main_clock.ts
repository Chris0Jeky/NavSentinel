/**
 * MAIN-world clock captured once at module evaluation.
 *
 * main_guard runs in the page's MAIN world, where `Date` resolves dynamically:
 * page script can replace `Date.now` after initialization and would otherwise
 * stretch or collapse every allowance, expiry, correlation, and ID timestamp.
 * This module evaluates at document_start (before page script runs, the same
 * assumption behind every other captured native) and keeps its own reference,
 * so later page mutation cannot alter guard timing. (#756)
 */
const capturedDateNow: () => number = Date.now;

export function nowMs(): number {
  return capturedDateNow();
}
