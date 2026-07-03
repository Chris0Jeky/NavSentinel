// Type declarations for the testable exports of check-bloom-real.mjs.
// main() is guarded so importing the module does not stat/read the committed file. (#321)
export const MIN_REAL_FILTER_BITS: number;
export function inspectBloomFilter(buf: Uint8Array): { real: boolean; m: number; k: number };
