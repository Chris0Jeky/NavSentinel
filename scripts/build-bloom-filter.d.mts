// Type declarations for the testable fail-closed guards of build-bloom-filter.mjs.
// main() is guarded so importing the module does not fetch threat feeds. (#322)
export function assertFeedsProducedDomains(count: number): void;
export function assertWithinBudget(filterSizeBytes: number, budgetBytes: number): void;
// Exported for the cross-implementation hash-agreement test. (#805)
export function murmurhash3_32(key: string, seed: number): number;
/** @throws {Error} if n is non-finite, or p is not in the open interval (0,1). */
export function optimalParams(n: number, p: number): { m: number; k: number };
