/**
 * MAIN-world code shares the page's JavaScript realm. Capture Date.now at
 * module initialization so a later page replacement cannot forge TTL and
 * correlation timestamps produced by NavSentinel.
 */
const capturedDateNow = Date.now.bind(Date);

export function mainWorldNowMs(): number {
  return capturedDateNow();
}
