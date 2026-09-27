/**
 * MAIN-world code shares the page's JavaScript realm. The synchronous
 * document_start loader captures Date.now before its async module import.
 * Its non-writable window property survives an intervening page script.
 */
const capturedDateNow = (globalThis as typeof globalThis & {
  __navsentinelMainDateNow?: () => number;
}).__navsentinelMainDateNow ?? Date.now.bind(Date);

export function mainWorldNowMs(): number {
  return capturedDateNow();
}
