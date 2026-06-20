// Type declarations for the testable export of check-bloom-size.mjs.
// main() is guarded so importing the module does not stat/read the committed file. (#322)
export function validateBloomBinary(buf: Uint8Array): { m: number; k: number };
