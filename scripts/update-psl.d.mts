// Type declarations for the testable exports of update-psl.mjs (the build script
// itself is plain JS; main() is guarded so importing it does not fetch). (#322)
export const MIN_PSL_RULES: number;

export interface PslRule {
  type: "exact" | "wildcard" | "exception";
  labels: string[];
}

export function parsePSL(text: string): PslRule[];
export function assertEnoughRules(rules: unknown): void;
export function buildTrie(rules: PslRule[]): unknown;
