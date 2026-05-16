/**
 * Navigation pattern anomaly detection (P4-08).
 *
 * Builds a local model of the user's navigation patterns and flags
 * significant deviations. If a user never visits crypto/wallet sites
 * but suddenly navigates to three wallet-connect pages in 10 seconds,
 * that is anomalous and should elevate the NRS.
 *
 * Storage: `navProfile` key in chrome.storage.local.
 * Privacy: Only category names and counts are stored. No PII.
 */

import { getRegistrableDomain } from "./domain";

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

export const NAV_PROFILE_KEY = "sentinelsuite:nav_profile_v1";

// ---------------------------------------------------------------------------
// Category taxonomy (~15 categories relevant for security)
// ---------------------------------------------------------------------------

export type NavCategory =
  | "crypto"
  | "banking"
  | "social"
  | "email"
  | "shopping"
  | "developer"
  | "entertainment"
  | "news"
  | "government"
  | "healthcare"
  | "education"
  | "cloud"
  | "vpn_proxy"
  | "unknown";

/**
 * Static domain-to-category mapping. Uses registrable domain as the key.
 * Covers the most commonly phished / security-relevant domains.
 */
const DOMAIN_CATEGORY_MAP: Record<string, NavCategory> = {
  // Crypto
  "binance.com": "crypto",
  "coinbase.com": "crypto",
  "kraken.com": "crypto",
  "metamask.io": "crypto",
  "walletconnect.com": "crypto",
  "walletconnect.org": "crypto",
  "blockchain.com": "crypto",
  "crypto.com": "crypto",
  "opensea.io": "crypto",
  "uniswap.org": "crypto",
  "etherscan.io": "crypto",
  "phantom.app": "crypto",
  "ledger.com": "crypto",
  "trezor.io": "crypto",
  "trustwallet.com": "crypto",
  "coinmarketcap.com": "crypto",
  "coingecko.com": "crypto",

  // Banking
  "chase.com": "banking",
  "bankofamerica.com": "banking",
  "wellsfargo.com": "banking",
  "citi.com": "banking",
  "citibank.com": "banking",
  "usbank.com": "banking",
  "capitalone.com": "banking",
  "hsbc.com": "banking",
  "barclays.co.uk": "banking",
  "lloydsbank.com": "banking",
  "natwest.com": "banking",
  "ing.com": "banking",
  "td.com": "banking",
  "rbc.com": "banking",
  "scotiabank.com": "banking",
  "paypal.com": "banking",
  "venmo.com": "banking",
  "wise.com": "banking",
  "revolut.com": "banking",
  "stripe.com": "banking",
  "squareup.com": "banking",

  // Social
  "facebook.com": "social",
  "twitter.com": "social",
  "x.com": "social",
  "instagram.com": "social",
  "linkedin.com": "social",
  "reddit.com": "social",
  "tiktok.com": "social",
  "snapchat.com": "social",
  "pinterest.com": "social",
  "discord.com": "social",
  "telegram.org": "social",
  "whatsapp.com": "social",
  "mastodon.social": "social",
  "tumblr.com": "social",

  // Email
  "gmail.com": "email",
  "mail.google.com": "email",
  "outlook.com": "email",
  "outlook.live.com": "email",
  "yahoo.com": "email",
  "proton.me": "email",
  "protonmail.com": "email",
  "zoho.com": "email",
  "icloud.com": "email",
  "aol.com": "email",
  "fastmail.com": "email",
  "tutanota.com": "email",

  // Shopping
  "amazon.com": "shopping",
  "amazon.co.uk": "shopping",
  "ebay.com": "shopping",
  "walmart.com": "shopping",
  "target.com": "shopping",
  "etsy.com": "shopping",
  "shopify.com": "shopping",
  "aliexpress.com": "shopping",
  "bestbuy.com": "shopping",
  "newegg.com": "shopping",

  // Developer
  "github.com": "developer",
  "gitlab.com": "developer",
  "stackoverflow.com": "developer",
  "npmjs.com": "developer",
  "pypi.org": "developer",
  "docker.com": "developer",
  "vercel.com": "developer",
  "netlify.com": "developer",
  "heroku.com": "developer",
  "digitalocean.com": "developer",
  "bitbucket.org": "developer",

  // Entertainment
  "youtube.com": "entertainment",
  "netflix.com": "entertainment",
  "spotify.com": "entertainment",
  "twitch.tv": "entertainment",
  "hulu.com": "entertainment",
  "disneyplus.com": "entertainment",
  "hbomax.com": "entertainment",
  "max.com": "entertainment",
  "primevideo.com": "entertainment",
  "soundcloud.com": "entertainment",
  "vimeo.com": "entertainment",

  // News
  "bbc.com": "news",
  "bbc.co.uk": "news",
  "cnn.com": "news",
  "nytimes.com": "news",
  "theguardian.com": "news",
  "reuters.com": "news",
  "apnews.com": "news",
  "washingtonpost.com": "news",
  "forbes.com": "news",
  "bloomberg.com": "news",

  // Government
  "gov.uk": "government",
  "irs.gov": "government",
  "ssa.gov": "government",
  "usa.gov": "government",

  // Healthcare
  "webmd.com": "healthcare",
  "mayoclinic.org": "healthcare",
  "nih.gov": "healthcare",

  // Education
  "wikipedia.org": "education",
  "khanacademy.org": "education",
  "coursera.org": "education",
  "edx.org": "education",
  "udemy.com": "education",

  // Cloud
  "google.com": "cloud",
  "microsoft.com": "cloud",
  "apple.com": "cloud",
  "dropbox.com": "cloud",
  "box.com": "cloud",
  "onedrive.live.com": "cloud",
  "drive.google.com": "cloud",

  // VPN / Proxy
  "nordvpn.com": "vpn_proxy",
  "expressvpn.com": "vpn_proxy",
  "surfshark.com": "vpn_proxy",
};

/**
 * Keyword-based fallback classification. If the domain does not appear
 * in the static map, we check for these keyword patterns in the hostname.
 */
const KEYWORD_PATTERNS: Array<{ pattern: RegExp; category: NavCategory }> = [
  { pattern: /wallet|metamask|defi|(?:^|[.-])swap(?:[.-]|$)|(?:^|[.-])nft(?:[.-]|$)|crypto|(?:^|[.-])coin(?:[.-]|$)|token|ethereum|etherscan|bitcoin|blockchain/i, category: "crypto" },
  { pattern: /(?:^|[.-])bank(?:ing)?(?:[.-]|$)|credit-union|savings|mortgage|(?:^|[.-])loan(?:[.-]|$)/i, category: "banking" },
  { pattern: /social|(?:^|[.-])chat(?:[.-]|$)|messenger|forum/i, category: "social" },
  { pattern: /mail|inbox|webmail/i, category: "email" },
  { pattern: /(?:^|[.-])shop(?:[.-]|$)|(?:^|[.-])store(?:[.-]|$)|(?:^|[.-])buy(?:[.-]|$)|(?:^|[.-])cart(?:[.-]|$)|(?:^|[.-])deal(?:[.-]|$)|market/i, category: "shopping" },
  { pattern: /github|gitlab|(?:^|[.-])code(?:[.-]|$)|(?:^|[.-])dev(?:[.-]|$)|(?:^|[.-])npm(?:[.-]|$)|(?:^|[.-])pip(?:[.-]|$)|docker/i, category: "developer" },
  { pattern: /stream|video|music|(?:^|[.-])game(?:[.-]|$)|movie|(?:^|[.-])watch(?:[.-]|$)/i, category: "entertainment" },
  { pattern: /news|(?:^|[.-])press(?:[.-]|$)|journal|gazette|herald|tribune/i, category: "news" },
  { pattern: /\.gov(\.[a-z]{2})?$/i, category: "government" },
  { pattern: /health|medical|clinic|hospital|pharma/i, category: "healthcare" },
  { pattern: /\.edu(\.[a-z]{2})?$|university|college|school|academy/i, category: "education" },
  { pattern: /cloud|storage|(?:^|[.-])drive(?:[.-]|$)|(?:^|[.-])sync(?:[.-]|$)/i, category: "cloud" },
  { pattern: /vpn|proxy|tunnel/i, category: "vpn_proxy" },
];

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

export interface BurstRecord {
  category: NavCategory;
  /** Timestamp of the burst detection. */
  ts: number;
  /** Number of navigations in the burst window. */
  count: number;
}

export interface NavProfile {
  categoryCounts: Record<string, number>;
  totalNavigations: number;
  lastUpdated: number;
  recentBurst: BurstRecord[];
}

/** In-memory sliding window entry for recent navigations. */
interface RecentNav {
  category: NavCategory;
  ts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Weekly decay factor (10% reduction). Applied on read when 7+ days have passed. */
export const DECAY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DECAY_FACTOR = 0.9;

/** Cap total stored navigations; normalize when exceeded. */
export const MAX_TOTAL_NAVIGATIONS = 10_000;

/** Burst detection window. */
export const BURST_WINDOW_MS = 30_000;

/** Minimum navigations to a rare category within the burst window to flag. */
export const BURST_MIN_COUNT = 2;

/** Category frequency threshold below which a category is considered "rare".
 * 5% means a category with < 5% of total navigations is rare enough to flag.
 * This accounts for the fact that burst navigations themselves increase the
 * category count, so a strict 1% threshold would self-defeat on small profiles. */
export const RARE_CATEGORY_THRESHOLD = 0.05;

/** Maximum burst records stored. */
export const MAX_BURST_RECORDS = 20;

/** Burst records older than this are pruned. */
export const BURST_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum number of decay iterations to prevent infinite loops. */
const MAX_DECAY_ITERATIONS = 52; // ~1 year of weekly decays

/** Anomaly score values. */
export const BASE_ANOMALY_SCORE = 10;
export const BURST_3_PLUS_BONUS = 5;
export const ANOMALY_SCORE_CAP = 15;

/** Minimum total navigations before anomaly detection activates. */
export const MIN_NAVIGATIONS_FOR_ANOMALY = 20;

// ---------------------------------------------------------------------------
// In-memory sliding window for burst detection
// ---------------------------------------------------------------------------

const recentNavs: RecentNav[] = [];
const MAX_RECENT_NAVS = 100;
let sessionNavCount = 0;

function pruneRecentNavs(now: number): void {
  const cutoff = now - BURST_WINDOW_MS;
  while (recentNavs.length > 0 && recentNavs[0]!.ts < cutoff) {
    recentNavs.shift();
  }
  // Hard cap to prevent unbounded growth
  if (recentNavs.length > MAX_RECENT_NAVS) {
    recentNavs.splice(0, recentNavs.length - MAX_RECENT_NAVS);
  }
}

function countRecentCategory(category: NavCategory, now: number): number {
  const cutoff = now - BURST_WINDOW_MS;
  let count = 0;
  for (const nav of recentNavs) {
    if (nav.ts >= cutoff && nav.category === category) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

/**
 * Classify a domain into a navigation category.
 * First checks the static map using the registrable domain, then falls
 * back to keyword matching on the full hostname.
 */
export function classifyDomain(hostname: string): NavCategory {
  if (!hostname) return "unknown";
  const lower = hostname.toLowerCase();

  // Try full hostname first (handles subdomain-specific overrides
  // like mail.google.com → email vs google.com → cloud)
  if (DOMAIN_CATEGORY_MAP[lower]) {
    return DOMAIN_CATEGORY_MAP[lower]!;
  }

  // Then try registrable domain
  const regDomain = getRegistrableDomain(lower);
  if (regDomain && DOMAIN_CATEGORY_MAP[regDomain]) {
    return DOMAIN_CATEGORY_MAP[regDomain]!;
  }

  // Keyword-based fallback
  for (const { pattern, category } of KEYWORD_PATTERNS) {
    if (pattern.test(lower)) {
      return category;
    }
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Decay logic
// ---------------------------------------------------------------------------

/**
 * Apply time-based weekly decay to category counts. Reduces all counts
 * by 10% per elapsed week. Modifies the profile in place.
 * Returns true if any decay was applied.
 */
export function applyDecay(profile: NavProfile, now: number): boolean {
  if (!Number.isFinite(profile.lastUpdated) || !Number.isFinite(now)) return false;
  if (now - profile.lastUpdated < DECAY_INTERVAL_MS) return false;

  let decayed = false;
  let iterations = 0;

  while (now - profile.lastUpdated >= DECAY_INTERVAL_MS && iterations < MAX_DECAY_ITERATIONS) {
    for (const key of Object.keys(profile.categoryCounts)) {
      profile.categoryCounts[key] = Math.floor(profile.categoryCounts[key]! * DECAY_FACTOR);
      if (profile.categoryCounts[key] === 0) {
        delete profile.categoryCounts[key];
      }
    }

    // Recompute total from category counts after decay
    profile.totalNavigations = Object.values(profile.categoryCounts)
      .reduce((sum, c) => sum + c, 0);

    profile.lastUpdated += DECAY_INTERVAL_MS;
    decayed = true;
    iterations++;
  }

  if (iterations === MAX_DECAY_ITERATIONS) {
    profile.lastUpdated = now;
  }

  return decayed;
}

/**
 * Normalize category counts when totalNavigations exceeds the cap.
 * Scales all counts proportionally so total equals MAX_TOTAL_NAVIGATIONS / 2.
 */
export function normalizeProfile(profile: NavProfile): void {
  if (profile.totalNavigations <= MAX_TOTAL_NAVIGATIONS) return;

  const scaleFactor = (MAX_TOTAL_NAVIGATIONS / 2) / profile.totalNavigations;

  for (const key of Object.keys(profile.categoryCounts)) {
    profile.categoryCounts[key] = Math.max(1, Math.floor(profile.categoryCounts[key]! * scaleFactor));
  }

  profile.totalNavigations = Object.values(profile.categoryCounts)
    .reduce((sum, c) => sum + c, 0);
}

/**
 * Prune burst records older than 24 hours and cap to MAX_BURST_RECORDS.
 */
export function pruneBurstRecords(profile: NavProfile, now: number): void {
  const cutoff = now - BURST_RECORD_TTL_MS;
  profile.recentBurst = profile.recentBurst
    .filter((b) => b.ts >= cutoff)
    .slice(-MAX_BURST_RECORDS);
}

// ---------------------------------------------------------------------------
// Storage access
// ---------------------------------------------------------------------------

function emptyProfile(now: number): NavProfile {
  return {
    categoryCounts: {},
    totalNavigations: 0,
    lastUpdated: now,
    recentBurst: [],
  };
}

async function loadProfile(): Promise<NavProfile> {
  const res = await chrome.storage.local.get(NAV_PROFILE_KEY);
  const raw = res[NAV_PROFILE_KEY];
  if (!raw || typeof raw !== "object") return emptyProfile(Date.now());

  const p = raw as NavProfile;
  // Forward-compat: ensure all fields exist
  if (typeof p.categoryCounts !== "object" || p.categoryCounts === null) {
    p.categoryCounts = {};
  }
  if (typeof p.totalNavigations !== "number") {
    p.totalNavigations = 0;
  }
  if (typeof p.lastUpdated !== "number") {
    p.lastUpdated = Date.now();
  }
  if (!Array.isArray(p.recentBurst)) {
    p.recentBurst = [];
  }
  return p;
}

async function saveProfile(profile: NavProfile): Promise<void> {
  await chrome.storage.local.set({ [NAV_PROFILE_KEY]: profile });
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

/**
 * Compute the anomaly score for a navigation to the given category.
 *
 * A navigation is anomalous if:
 *   a. The destination category has < 5% of total navigations AND
 *   b. There have been 2+ navigations to that same rare category within 30 seconds
 *
 * Score: 10 if conditions met, +5 if 3+ bursts in 30s. Capped at 15.
 */
export function computeAnomalyScore(
  profile: NavProfile,
  category: NavCategory,
  recentCategoryCount: number,
): number {
  // Don't flag "unknown" category -- too noisy
  if (category === "unknown") return 0;

  // Need minimum navigations for meaningful frequency analysis
  if (profile.totalNavigations < MIN_NAVIGATIONS_FOR_ANOMALY) return 0;

  // Check if category is rare (< 5% of total navigations).
  // Subtract recent burst navigations from the stored count to avoid
  // the burst itself inflating the frequency and self-defeating detection.
  // The -1 accounts for the current navigation already added to the window
  // but not yet recorded in the profile.
  const storedCount = profile.categoryCounts[category] ?? 0;
  const burstInflation = Math.max(0, recentCategoryCount - 1);
  const preBurstCount = Math.max(0, storedCount - burstInflation);
  const preBurstTotal = Math.max(1, profile.totalNavigations - burstInflation);
  const frequency = preBurstCount / preBurstTotal;
  if (frequency >= RARE_CATEGORY_THRESHOLD) return 0;

  // Check burst condition: 2+ in 30 seconds
  if (recentCategoryCount < BURST_MIN_COUNT) return 0;

  // Base anomaly score
  let score = BASE_ANOMALY_SCORE;

  // Bonus for 3+ navigations in the burst window
  if (recentCategoryCount >= 3) {
    score += BURST_3_PLUS_BONUS;
  }

  return Math.min(score, ANOMALY_SCORE_CAP);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let pending: Promise<unknown> = Promise.resolve();

/**
 * Record a navigation and compute anomaly score for the destination.
 *
 * Returns the anomaly score (0-15) that should be fed into NRS.
 * Serialized via promise chain to prevent concurrent read-modify-write races.
 */
export function recordNavigationAnomaly(
  hostname: string,
  nowOverride?: number,
): Promise<number> {
  const next = pending.then(async (): Promise<number> => {
    const now = nowOverride ?? Date.now();
    const category = classifyDomain(hostname);

    // Update in-memory sliding window
    pruneRecentNavs(now);
    recentNavs.push({ category, ts: now });
    const recentCount = countRecentCategory(category, now);

    // Load and decay profile
    const profile = await loadProfile();
    applyDecay(profile, now);
    pruneBurstRecords(profile, now);

    // Compute anomaly BEFORE updating counts (so current nav
    // does not inflate the frequency of the destination category)
    const anomalyScore = computeAnomalyScore(profile, category, recentCount);

    // Record burst if anomaly detected
    if (anomalyScore > 0) {
      profile.recentBurst.push({
        category,
        ts: now,
        count: recentCount,
      });
      // Re-prune after adding
      if (profile.recentBurst.length > MAX_BURST_RECORDS) {
        profile.recentBurst = profile.recentBurst.slice(-MAX_BURST_RECORDS);
      }
    }

    // Update category count
    profile.categoryCounts[category] = (profile.categoryCounts[category] ?? 0) + 1;
    profile.totalNavigations += 1;
    sessionNavCount = Math.max(sessionNavCount, profile.totalNavigations);
    profile.lastUpdated = now;

    // Normalize if cap exceeded
    normalizeProfile(profile);

    await saveProfile(profile);

    return anomalyScore;
  });

  pending = next.catch((err) => {
    console.warn("[NavSentinel] nav anomaly serialization error:", err);
  });

  return next;
}

/**
 * Get the current anomaly score for a destination without recording.
 * Used for synchronous NRS integration where the recording happens
 * asynchronously afterward.
 */
export function getAnomalyScoreSync(
  hostname: string,
  now?: number,
): number {
  const ts = now ?? Date.now();
  const category = classifyDomain(hostname);
  pruneRecentNavs(ts);
  const recentCount = countRecentCategory(category, ts);

  if (sessionNavCount < MIN_NAVIGATIONS_FOR_ANOMALY) return 0;
  if (recentCount < BURST_MIN_COUNT || category === "unknown") return 0;

  let score = BASE_ANOMALY_SCORE;
  if (recentCount >= 3) {
    score += BURST_3_PLUS_BONUS;
  }
  return Math.min(score, ANOMALY_SCORE_CAP);
}

/**
 * Clear the navigation profile and in-memory state.
 */
export async function clearNavProfile(): Promise<void> {
  await chrome.storage.local.set({ [NAV_PROFILE_KEY]: null });
  recentNavs.length = 0;
}

/**
 * Exported for testing: reset in-memory sliding window.
 */
export function _resetRecentNavs(): void {
  recentNavs.length = 0;
  sessionNavCount = 0;
}

/**
 * Exported for testing: get current sliding window contents.
 */
export function _getRecentNavs(): ReadonlyArray<RecentNav> {
  return recentNavs;
}
