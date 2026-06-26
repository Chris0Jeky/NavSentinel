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

// Synchronous snapshot of the stored profile's category frequencies, refreshed
// by recordNavigationAnomaly and primeAnomalySession. Lets getAnomalyScoreSync
// apply the same rarity gate as computeAnomalyScore (which needs the profile)
// without an async load — without it the sync path would flag bursts to
// categories the user visits frequently (false positives into the live NRS).
let cachedTotalNavigations = 0;
let cachedCategoryCounts: Record<string, number> = {};

function refreshFrequencyCache(profile: NavProfile): void {
  cachedTotalNavigations = Number.isFinite(profile.totalNavigations)
    ? profile.totalNavigations
    : 0;
  cachedCategoryCounts = { ...profile.categoryCounts };
}

function resetFrequencyCache(): void {
  cachedTotalNavigations = 0;
  cachedCategoryCounts = {};
}

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
  // like mail.google.com → email vs google.com → cloud).
  // Use Object.hasOwn so inherited keys like "__proto__" can't return a
  // prototype object instead of a real NavCategory.
  if (Object.hasOwn(DOMAIN_CATEGORY_MAP, lower)) {
    return DOMAIN_CATEGORY_MAP[lower]!;
  }

  // Then try registrable domain
  const regDomain = getRegistrableDomain(lower);
  if (regDomain && Object.hasOwn(DOMAIN_CATEGORY_MAP, regDomain)) {
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
  } else {
    // Drop corrupt non-finite category counts (typeof check below misses NaN since
    // typeof NaN === "number"). A NaN count would bypass the rarity gate (NaN >= threshold
    // is false) AND re-poison totalNavigations via applyDecay/normalizeProfile's unguarded
    // `sum + c`, cascading NaN to every count and the session gate. Dropping it keeps those
    // recomputes finite. totalNavigations itself is left for the per-consumer guards so the
    // #297/#372 prime-guard's corruption signal survives. (#373)
    for (const key of Object.keys(p.categoryCounts)) {
      if (!Number.isFinite(p.categoryCounts[key])) delete p.categoryCounts[key];
    }
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

  // Need minimum navigations for meaningful frequency analysis. The Number.isFinite
  // check is load-bearing: a corrupt non-finite totalNavigations would make `NaN < MIN`
  // false here AND `NaN >= RARE_CATEGORY_THRESHOLD` false below, bypassing BOTH gates and
  // scoring every burst — a corrupt profile must score nothing, not everything. (#373)
  if (!Number.isFinite(profile.totalNavigations) || profile.totalNavigations < MIN_NAVIGATIONS_FOR_ANOMALY) {
    return 0;
  }

  // Check if category is rare (< 5% of total navigations).
  // Subtract recent burst navigations from the stored count to avoid
  // the burst itself inflating the frequency and self-defeating detection.
  // The -1 accounts for the current navigation already added to the window
  // but not yet recorded in the profile.
  const storedCount = profile.categoryCounts[category] ?? 0;
  // Defence-in-depth: loadProfile drops non-finite counts, but this is an exported fn that
  // could be called with a raw profile. A NaN storedCount would make `NaN >= threshold`
  // false (rarity-gate bypass), so gate off a corrupt destination-category count. (#373)
  if (!Number.isFinite(storedCount)) return 0;
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

    // Update in-memory sliding window. Keep the entry reference so it can be rolled back
    // if the storage round-trip below fails (#286): pushing before the await is required so
    // computeAnomalyScore counts the current nav, but a rejected loadProfile/saveProfile
    // must not leave this phantom entry behind — it would inflate the NEXT navigation's
    // burst count (recentCount) and fire a false anomaly within the burst window.
    pruneRecentNavs(now);
    const navEntry = { category, ts: now };
    recentNavs.push(navEntry);
    const recentCount = countRecentCategory(category, now);

    try {
      // Load and decay profile
      const profile = await loadProfile();
      // Self-heal a corrupt non-finite totalNavigations BEFORE it propagates: `+= 1` would
      // keep NaN (sticky in storage on save), `Math.max(sessionNavCount, NaN)` would poison
      // the session gate (NaN < MIN is false → gate bypass), and the cache refresh below would
      // run against it. Recompute from the (finite) category counts so the rarity baseline is
      // preserved rather than wiped. Mirrors the prime-path guard in #297. (#373)
      if (!Number.isFinite(profile.totalNavigations)) {
        // loadProfile has already dropped any non-finite counts, so this sum is finite.
        profile.totalNavigations = Object.values(profile.categoryCounts).reduce((sum, n) => sum + n, 0);
      }
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
      profile.lastUpdated = now;

      // Normalize if cap exceeded
      normalizeProfile(profile);

      await saveProfile(profile);

      // Update the session gate + frequency snapshot ONLY after a successful save,
      // so a rejected save can't leave sessionNavCount armed against a stale cache
      // (which would bias the sync path toward over-detection).
      sessionNavCount = Math.max(sessionNavCount, profile.totalNavigations);
      refreshFrequencyCache(profile);

      return anomalyScore;
    } catch (err) {
      // Roll back the sliding-window entry so the failed nav leaves no phantom (#286).
      const idx = recentNavs.indexOf(navEntry);
      if (idx !== -1) recentNavs.splice(idx, 1);
      throw err;
    }
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
  if (category === "unknown") return 0;
  pruneRecentNavs(ts);
  // +1 for the current navigation. recordNavigationAnomaly pushes this nav into
  // the window before counting, but it runs asynchronously AFTER this sync read,
  // so the window here is missing the current nav. Counting it aligns the sync
  // burst check with what the async path computes — otherwise the burst is
  // flagged one navigation late (under-scoring the nav that completes the burst).
  const recentCount = countRecentCategory(category, ts) + 1;

  if (sessionNavCount < MIN_NAVIGATIONS_FOR_ANOMALY) return 0;
  if (recentCount < BURST_MIN_COUNT) return 0;

  // Rarity gate (mirrors computeAnomalyScore) against the cached profile
  // snapshot: do NOT flag a burst to a category the user visits regularly
  // (>= RARE_CATEGORY_THRESHOLD of navigations). The burst itself is subtracted
  // so it cannot inflate the category's frequency and self-defeat the gate.
  const storedCount = cachedCategoryCounts[category] ?? 0;
  const burstInflation = Math.max(0, recentCount - 1);
  const preBurstCount = Math.max(0, storedCount - burstInflation);
  const preBurstTotal = Math.max(1, cachedTotalNavigations - burstInflation);
  if (preBurstCount / preBurstTotal >= RARE_CATEGORY_THRESHOLD) return 0;

  let score = BASE_ANOMALY_SCORE;
  if (recentCount >= 3) {
    score += BURST_3_PLUS_BONUS;
  }
  return Math.min(score, ANOMALY_SCORE_CAP);
}

/**
 * Seed sessionNavCount from the stored profile so getAnomalyScoreSync works for
 * a returning user on a fresh content-script load, instead of returning 0 until
 * MIN_NAVIGATIONS_FOR_ANOMALY navigations accrue in THIS session (which would
 * blind anomaly detection on the first navigations of every page load).
 *
 * Serialized through the same `pending` chain as recordNavigationAnomaly. It is
 * read-only (no save), and Math.max keeps sessionNavCount monotonic, so even a
 * stale read can only under-seed (never lose a higher in-session count). A
 * non-finite stored totalNavigations (corrupt storage) is ignored so it cannot
 * poison the gate (NaN would make `< MIN` false and silently enable scoring).
 */
export function primeAnomalySession(): Promise<void> {
  const next = pending.then(async (): Promise<void> => {
    const profile = await loadProfile();
    // Only seed BOTH the gate and the frequency cache from a non-corrupt profile. A
    // non-finite totalNavigations marks a corrupt stored profile; refreshing the cache from
    // it would overwrite cachedCategoryCounts with possibly-bogus counts while the gate
    // stays armed from prior in-session records (sessionNavCount), so a later burst to a
    // genuinely-frequent category could escape the rarity gate (a false positive). Keep the
    // existing good cache instead. (#297)
    if (Number.isFinite(profile.totalNavigations)) {
      sessionNavCount = Math.max(sessionNavCount, profile.totalNavigations);
      refreshFrequencyCache(profile);
    }
  });
  pending = next.catch((err) => {
    console.warn("[NavSentinel] nav anomaly prime error:", err);
  });
  return next;
}

/**
 * Clear the navigation profile and in-memory state.
 *
 * Serialized through the same `pending` chain as recordNavigationAnomaly /
 * primeAnomalySession so a concurrent in-flight record cannot resurrect the
 * cleared profile (its load-compute-save would otherwise complete after the
 * clear and re-persist the stale profile + re-arm the gate/cache).
 */
export function clearNavProfile(): Promise<void> {
  const next = pending.then(async (): Promise<void> => {
    await chrome.storage.local.set({ [NAV_PROFILE_KEY]: null });
    recentNavs.length = 0;
    // Reset the session gate + frequency cache so a stale high seed doesn't keep
    // anomaly scoring active against a now-empty profile.
    sessionNavCount = 0;
    resetFrequencyCache();
  });
  pending = next.catch((err) => {
    console.warn("[NavSentinel] nav anomaly clear error:", err);
  });
  return next;
}

/**
 * Exported for testing: reset in-memory sliding window.
 */
export function _resetRecentNavs(): void {
  recentNavs.length = 0;
  sessionNavCount = 0;
  resetFrequencyCache();
  // Reset the serialization chain so a prior test's queued/failed promise tail cannot carry
  // forward into the next test (same inter-test isolation concern as the storage-mock reset). (#286 R2)
  pending = Promise.resolve();
}

/**
 * Exported for testing: get current sliding window contents.
 */
export function _getRecentNavs(): ReadonlyArray<RecentNav> {
  return recentNavs;
}
