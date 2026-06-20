// Type declarations for the testable fail-closed guards of build-bloom-filter.mjs.
// main() is guarded so importing the module does not fetch threat feeds. (#322)
export function assertFeedsProducedDomains(count: number): void;
export function assertWithinBudget(filterSizeBytes: number, budgetBytes: number): void;
export function optimalParams(n: number, p: number): { m: number; k: number };
