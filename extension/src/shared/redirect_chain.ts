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
}

// --- Constants ---

const CHAIN_WINDOW_MS = 10_000;
const CHAIN_STALE_MS = 15_000;
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

const REDIRECT_PARAMS = new Set([
  "url",
  "redirect",
  "next",
  "goto",
  "dest",
  "target",
  "continue",
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

  // Exact shortener domain match
  if (SHORTENER_DOMAINS.has(hostname)) return true;

  // Tracking subdomain prefix match (e.g. click.example.com)
  for (const prefix of TRACKING_PREFIXES) {
    if (hostname.startsWith(prefix)) return true;
  }

  // Redirect query parameters
  for (const key of parsed.searchParams.keys()) {
    if (REDIRECT_PARAMS.has(key.toLowerCase())) return true;
  }

  // Open redirect path patterns (e.g. /redirect?url=...)
  const pathname = parsed.pathname.toLowerCase();
  for (const rpath of OPEN_REDIRECT_PATHS) {
    if (pathname === rpath || pathname.startsWith(rpath + "?") || pathname.startsWith(rpath + "/")) {
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
  private chains = new Map<number, RedirectChain>();

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
      if (ts - lastHop.ts <= CHAIN_WINDOW_MS && existing.hops.length < CHAIN_MAX_HOPS) {
        existing.hops.push(hop);
        return;
      }
    }

    // Start a new chain
    this.chains.set(tabId, { hops: [hop], startedAt: ts });
    this.enforceMapLimit();
  }

  /**
   * Get chain info for a tab. Returns null if no meaningful chain exists
   * (single-hop chains are not considered redirect chains).
   */
  getChainInfo(tabId: number): RedirectChainInfo | null {
    const chain = this.chains.get(tabId);
    if (!chain || chain.hops.length < 2) return null;

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
    };
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
      if (lastHop && now - lastHop.ts > CHAIN_STALE_MS) {
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
