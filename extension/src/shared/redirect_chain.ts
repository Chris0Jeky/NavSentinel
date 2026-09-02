/**
 * Redirect chain correlation: tracks multi-hop redirect chains per tab
 * and identifies known redirector patterns (URL shorteners, tracking,
 * open redirect parameters).
 */

// --- Types ---

export interface RedirectHop {
  url: string;
  ts: number;
  transitionType: string;
}

export interface RedirectChain {
  hops: RedirectHop[];
  startedAt: number;
}

export interface RedirectChainInfo {
  depth: number;
  viaKnownRedirector: boolean;
  knownRedirectorHops: number;
  /** Absolute time at which this chain must stop contributing to scoring. */
  expiresAt: number;
}

// --- Constants ---

const CHAIN_WINDOW_MS = 10_000;
export const CHAIN_STALE_MS = 15_000;
const CHAIN_MAX_HOPS = 10;
const CHAIN_MAP_MAX = 100;

// --- Known redirector patterns ---

const SHORTENER_DOMAINS = new Set([
  "bit.ly",
  "t.co",
  "goo.gl",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
]);

const TRACKING_PREFIXES = [
  "click.",
  "track.",
  "redirect.",
  "go.",
  "redir.",
];

/**
 * Known-legitimate hosts that happen to match a TRACKING_PREFIXES entry
 * (e.g. go.microsoft.com, go.dev, click.mailchimp.com).
 * These are NOT attacker-operated redirectors.
 *
 * A matched host is fully exempt from isKnownRedirector (#285), so every entry
 * must be a real, brand-controlled, publicly resolving host: an entry that does
 * not resolve is dead config, and one a third party could register would be a
 * free pass through redirector detection. Each entry records the evidence that
 * keeps it -- do not add one without equivalent evidence.
 *
 * Audited 2026-08-07 (#295). Removed as NXDOMAIN at 8.8.8.8: "go.google.com"
 * (no such host) and "go.googleprod.com" (googleprod.com is Google-owned --
 * MarkMonitor, NS1-4.GOOGLE.COM, registry-locked -- but has no "go" host and no
 * A record, and the real internal go-link host go.corp.google.com is never
 * reachable from a user browser). Neither was attacker-registerable, so this is
 * dead-config hygiene, not a closed bypass.
 */
const TRACKING_PREFIX_ALLOWLIST = new Set([
  // Microsoft's FWLink forwarding service, documented at
  // learn.microsoft.com/en-us/product-style-guide-msft-internal/link-guidelines/fwlink-guidelines/create-an-fwlink
  // Verified 2026-08-07: /fwlink/?linkid=2109783 -> HTTP 302 to www.bing.com.
  "go.microsoft.com",
  // The official Go language site. It is not a redirector at all -- it only
  // matches because the "go." prefix check is a string prefix on the whole
  // hostname, so without this entry every go.dev doc page scores as one.
  // Verified 2026-08-07: HTTP 200; A records 216.239.32/34/36/38.21 (Google).
  "go.dev",
  // Mailchimp's click-tracking host. Verified 2026-08-07: CNAME ->
  // mandrillapp.com (Mailchimp's Mandrill infrastructure); mailchimp.com RDAP
  // shows registrar "MarkMonitor Inc." with Akamai (*.AKAM.NET) nameservers.
  "click.mailchimp.com",
  // Kit's (formerly ConvertKit) link-handling host. Verified 2026-08-07: CNAME
  // -> link-handling-1410854111.us-east-2.elb.amazonaws.com, and an HTTPS GET
  // returns HTTP 301 to app.kit.com; convertkit.com itself 301s to kit.com.
  // Note: Kit's currently documented tracking domain is click.convertkit-mail.com,
  // which is deliberately NOT added here -- adding an allowlist entry loosens
  // detection and should follow an observed false positive.
  "click.convertkit.com",
  // Postmark's link-tracking host. postmarkapp.com/support/article/1059-what-is-pstmrk-it
  // states "we use the pstmrk.it domain for link tracking"; the user-visible
  // host is click.pstmrk.it. Verified 2026-08-07: resolves, HTTP 302 to pstmrk.it.
  "click.pstmrk.it",
]);

/** Only redirect-specific params. Removed overly generic SSO/OAuth
 *  params (next, continue, target) that cause false positives. */
const REDIRECT_PARAMS = new Set([
  "url",
  "redirect",
  "redirect_uri",
  "redirect_url",
  "goto",
  "dest",
  "return_to",
]);

const OPEN_REDIRECT_PATHS = [
  "/redirect",
  "/go",
  "/redir",
  "/out",
  "/link",
];

/**
 * Check whether a URL belongs to a known redirector.
 */
export function isKnownRedirector(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Exact shortener domain match (definitive).
  if (SHORTENER_DOMAINS.has(hostname)) return true;

  // Known-legitimate tracking services (e.g. go.microsoft.com, click.pstmrk.it) deliver real
  // tracked-link URLs whose hostnames match tracking prefixes AND whose paths/params match the
  // open-redirect heuristics below. Exempt them from ALL heuristic checks, not just the prefix
  // check (#285): the earlier guard wrapped only the prefix loop, so an allowlisted host with a
  // `?url=`/`?redirect=` param or a `/link/`-style path still false-positived as a redirector.
  if (TRACKING_PREFIX_ALLOWLIST.has(hostname)) return false;

  // Tracking subdomain prefix match (e.g. click.example.com).
  for (const prefix of TRACKING_PREFIXES) {
    if (hostname.startsWith(prefix)) return true;
  }

  // Redirect query parameters
  for (const key of parsed.searchParams.keys()) {
    if (REDIRECT_PARAMS.has(key.toLowerCase())) return true;
  }

  // Open redirect path patterns (e.g. /redirect?url=...)
  // Note: URL.pathname never includes the query string, so we only
  // need exact match or path-prefix match (no "?" check needed).
  const pathname = parsed.pathname.toLowerCase();
  for (const rpath of OPEN_REDIRECT_PATHS) {
    if (pathname === rpath || pathname.startsWith(rpath + "/")) {
      return true;
    }
  }

  return false;
}

// --- Chain tracking ---

/**
 * Manages per-tab redirect chain state. Designed for use in the MV3
 * service worker (module-level maps, lost on restart).
 */
export class RedirectChainTracker {
  private chains: Map<number, RedirectChain>;

  /**
   * @param backingMap Optional external Map to use as the backing store.
   *   When provided, the tracker reads/writes from this Map directly,
   *   allowing an outer layer (e.g. SessionStateManager) to persist it.
   */
  constructor(backingMap?: Map<number, RedirectChain>) {
    this.chains = backingMap ?? new Map<number, RedirectChain>();
  }

  /**
   * Record a navigation commit for a tab. If the commit is within the
   * chain window of the previous hop, it extends the chain; otherwise
   * a new chain is started.
   */
  recordHop(tabId: number, url: string, ts: number, transitionType: string): void {
    this.pruneStale(ts);

    const existing = this.chains.get(tabId);
    const hop: RedirectHop = { url, ts, transitionType };

    if (existing && existing.hops.length > 0) {
      const lastHop = existing.hops[existing.hops.length - 1]!;
      if (ts - lastHop.ts <= CHAIN_WINDOW_MS) {
        if (existing.hops.length < CHAIN_MAX_HOPS) {
          existing.hops.push(hop);
        }
        // At max hops: stop appending but preserve the chain so the
        // "long chain" signal is not lost on the landing page.
        return;
      }
    }

    // Start a new chain
    this.chains.set(tabId, { hops: [hop], startedAt: ts });
    this.enforceMapLimit();
  }

  /**
   * Get chain info for a tab at an explicit point in time. A read is also a
   * pruning boundary: a session-restored chain must not remain usable merely
   * because no later navigation happened to call recordHop.
   * Returns null if no meaningful chain exists (single-hop chains are not
   * considered redirect chains).
   */
  getChainInfo(tabId: number, now: number = Date.now()): RedirectChainInfo | null {
    this.pruneStale(now);
    const chain = this.chains.get(tabId);
    if (!chain || chain.hops.length < 2) return null;

    const lastHop = chain.hops[chain.hops.length - 1];
    if (!lastHop) return null;
    const expiresAt = lastHop.ts + CHAIN_STALE_MS;

    let knownRedirectorHops = 0;
    for (const hop of chain.hops) {
      if (isKnownRedirector(hop.url)) {
        knownRedirectorHops++;
      }
    }

    return {
      depth: chain.hops.length,
      viaKnownRedirector: knownRedirectorHops > 0,
      knownRedirectorHops,
      expiresAt,
    };
  }

  /**
   * Returns true if the tab has an active (non-stale) chain with at
   * least one hop whose timestamp is within the chain window of `now`.
   * Used by the SW to decide whether a non-redirect commit should
   * extend an existing chain.
   */
  hasActiveChain(tabId: number, now: number): boolean {
    const chain = this.chains.get(tabId);
    if (!chain || chain.hops.length === 0) return false;
    const lastHop = chain.hops[chain.hops.length - 1]!;
    return now - lastHop.ts <= CHAIN_WINDOW_MS;
  }

  /**
   * Remove chain state for a tab (e.g. on tab close).
   */
  deleteTab(tabId: number): void {
    this.chains.delete(tabId);
  }

  /** Visible for testing. */
  get size(): number {
    return this.chains.size;
  }

  private pruneStale(now: number): void {
    for (const [tabId, chain] of this.chains) {
      const lastHop = chain.hops[chain.hops.length - 1];
      // Defensive: an empty-hops chain has no lastHop, so the lastHop-based staleness check
      // never fires and the entry would persist indefinitely. Session restore now rejects
      // empty-hops chains (#390), so this only guards a chain set directly into the backing
      // map outside the recordHop path (tests, future callers); fall back to startedAt so it
      // is still time-pruned. (#285, #390)
      const refTs = lastHop ? lastHop.ts : chain.startedAt;
      if (now - refTs >= CHAIN_STALE_MS) {
        this.chains.delete(tabId);
      }
    }
  }

  private enforceMapLimit(): void {
    if (this.chains.size <= CHAIN_MAP_MAX) return;
    // Drop oldest chains by startedAt
    const sorted = [...this.chains.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
    const excess = this.chains.size - CHAIN_MAP_MAX;
    for (let i = 0; i < excess; i++) {
      this.chains.delete(sorted[i]![0]);
    }
  }
}
