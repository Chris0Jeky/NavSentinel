// Type declarations for the testable exports of build-topsites-tier.mjs (the build
// script itself is plain JS; main() is guarded so importing it does not read or write
// any files). (#322)
export function compareTopSiteDomains(a: string, b: string): number;
