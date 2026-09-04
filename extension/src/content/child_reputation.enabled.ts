type ReputationResult = { knownBad: boolean; filterReady: boolean };
type ReputationCheck = (domain: string) => Promise<ReputationResult>;
type EventAppend = (entry: {
  kind: "nav_reputation_late_warn";
  site: string;
  url: string;
  destHost: string;
  reasons: string[];
}) => Promise<void>;
type ToastShow = (options: { message: string; timeoutMs: number }) => void;

export function checkChildFrameReputation(
  registrableDomain: string,
  hostname: string | null,
  href: string | null | undefined,
  debug: boolean,
  checkReputation: ReputationCheck,
  appendEvent: EventAppend,
  showToast: ToastShow,
): void {
  void (async () => {
    try {
      const checks = [checkReputation(registrableDomain)];
      if (hostname !== null && hostname !== registrableDomain) {
        checks.push(checkReputation(hostname));
      }
      const results = await Promise.all(checks);
      const knownBad = results.some((result) => result.knownBad);
      const filterReady = results.some((result) => result.filterReady);
      if (!knownBad) {
        if (!filterReady && debug) {
          console.debug("[NavSentinel] Child-frame reputation check: filter not ready in SW");
        }
        return;
      }

      const badHost = hostname ?? registrableDomain;
      void appendEvent({
        kind: "nav_reputation_late_warn",
        site: location.hostname.toLowerCase(),
        url: href ?? location.href,
        destHost: badHost,
        reasons: ["late_async_child_frame"],
      }).catch(() => {});
      showToast({
        message: `NavSentinel warning: ${badHost} is a known malicious domain`,
        timeoutMs: 8000,
      });
    } catch {
      // Graceful degradation: service worker unreachable.
    }
  })();
}
