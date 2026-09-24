export function checkChildFrameReputation(
  _registrableDomain: string,
  _hostname: string | null,
  _href: string | null | undefined,
  _debug: boolean,
  _checkReputation: (domain: string) => Promise<{ knownBad: boolean; filterReady: boolean }>,
  _appendEvent: (entry: {
    kind: "nav_reputation_late_warn";
    site: string;
    url: string;
    destHost: string;
    reasons: string[];
  }) => Promise<void>,
  _showToast: (options: { message: string; timeoutMs: number }) => void,
): void {
  // Interaction-only release builds intentionally link no reputation support.
}
