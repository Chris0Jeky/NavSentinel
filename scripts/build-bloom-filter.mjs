/**
 * Builds a bloom filter of known-bad domains from public threat feeds
 * and writes it to extension/public/reputation_data.bin.
 *
 * Feeds:
 *   - URLhaus CSV (abuse.ch)
 *   - OpenPhish community feed
 *
 * The output is a binary file containing a serialized bloom filter
 * with header: magic(4) + version(4) + k(4) + m(4) + bits(ceil(m/8)).
 *
 * This is the PRODUCTION builder: if both feeds return zero domains it FAILS
 * CLOSED (throws -> exit 1) rather than shipping a placeholder filter, and it
 * fails on size-budget overflow. For intentional test data use the separate
 * scripts/build-test-bloom-filter.mjs (`npm run build:bloom:test`).
 *
 * Usage:  node scripts/build-bloom-filter.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(
  __dirname,
  "..",
  "extension",
  "public",
  "reputation_data.bin"
);

// ---------------------------------------------------------------------------
// Bloom filter primitives (duplicated from reputation.ts for Node.js use)
// ---------------------------------------------------------------------------

function murmurhash3_32(key, seed) {
  let h = seed >>> 0;
  const len = key.length;
  const nblocks = len >> 2;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < nblocks; i++) {
    let k =
      (key.charCodeAt(i * 4) & 0xff) |
      ((key.charCodeAt(i * 4 + 1) & 0xff) << 8) |
      ((key.charCodeAt(i * 4 + 2) & 0xff) << 16) |
      ((key.charCodeAt(i * 4 + 3) & 0xff) << 24);

    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  const tail = nblocks * 4;
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= (key.charCodeAt(tail + 2) & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (key.charCodeAt(tail + 1) & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= key.charCodeAt(tail) & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h ^= k1;
  }

  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

const HEADER_MAGIC = 0x424c4f4d;
const HEADER_VERSION = 1;
const HEADER_SIZE = 16;

export function optimalParams(n, p) {
  // Fail closed on a non-finite element count or an out-of-range false-positive rate.
  // With p <= 0, Math.log(p) is -Infinity/NaN -> m becomes Infinity/NaN; with p >= 1,
  // Math.log(p) >= 0 -> m becomes <= 0; a non-finite n (NaN/Infinity) slips past the
  // n <= 0 check and also yields a non-finite m. Any of these would silently produce a
  // corrupt or absurdly sized filter binary instead of an honest error, so we throw
  // here rather than let a misconfigured TARGET_FP_RATE poison the build. (#322 / #14)
  if (!Number.isFinite(n)) {
    throw new Error(`optimalParams: element count must be finite, got ${n}`);
  }
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`optimalParams: false-positive rate must be in the open interval (0,1), got ${p}`);
  }
  if (n <= 0) return { m: 8, k: 1 };
  const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

function createFilter(m, k) {
  return {
    bits: new Uint8Array(Math.ceil(m / 8)),
    m,
    k,
  };
}

function insertDomain(filter, domain) {
  if (!domain || filter.m === 0) return;
  const key = domain.toLowerCase();
  const h1 = murmurhash3_32(key, 0x9747b28c);
  // Force h2 to be odd -- must match runtime checkDomain derivation.
  const h2 = murmurhash3_32(key, 0xc6a4a793) | 1;

  for (let i = 0; i < filter.k; i++) {
    const bit = ((h1 + Math.imul(i, h2)) >>> 0) % filter.m;
    const byteIndex = bit >>> 3;
    const bitIndex = bit & 7;
    filter.bits[byteIndex] |= 1 << bitIndex;
  }
}

function serializeFilter(filter) {
  const expectedBytes = Math.ceil(filter.m / 8);
  const out = new Uint8Array(HEADER_SIZE + expectedBytes);
  const view = new DataView(out.buffer);

  view.setUint32(0, HEADER_MAGIC, true);
  view.setUint32(4, HEADER_VERSION, true);
  view.setUint32(8, filter.k, true);
  view.setUint32(12, filter.m, true);

  out.set(filter.bits.subarray(0, expectedBytes), HEADER_SIZE);
  return out;
}

// ---------------------------------------------------------------------------
// Domain normalization
// ---------------------------------------------------------------------------

/**
 * Extract a rough "registrable domain" from a hostname by keeping only the
 * last two labels (or three for known two-part TLDs like .co.uk).
 * This is a best-effort approximation -- the runtime uses a full PSL trie.
 * The goal is to ensure that when a feed lists "evil.sub.example.com",
 * we also insert "example.com" so the runtime registrable-domain check works.
 */
const TWO_PART_TLDS = new Set([
  "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "co.in", "co.id",
  "com.au", "com.br", "com.cn", "com.mx", "com.tw", "com.sg",
  "org.uk", "org.au", "net.au", "ac.uk", "gov.uk",
]);

function getBaseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

// ---------------------------------------------------------------------------
// Feed fetchers
// ---------------------------------------------------------------------------

const URLHAUS_CSV_URL = "https://urlhaus.abuse.ch/downloads/csv/";
const OPENPHISH_FEED_URL = "https://openphish.com/feed.txt";

const FETCH_TIMEOUT_MS = 30_000;
/** Maximum response body size (50 MB) to prevent OOM from a hijacked feed. */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/**
 * Stream-read response body up to a byte limit. Avoids trusting
 * Content-Length alone (which can be absent or spoofed).
 */
async function readTextWithLimit(res, limit = MAX_RESPONSE_BYTES) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > limit) {
      reader.cancel();
      throw new Error(`Response body exceeded ${limit} byte limit`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * Fetch with a timeout and response size limit.
 */
async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    // Check Content-Length header if available
    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large: ${cl} bytes (limit ${MAX_RESPONSE_BYTES})`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract domains from URLhaus CSV feed.
 * CSV columns: id, dateadded, url, url_status, last_online, threat, tags, urlhaus_link, reporter
 * Lines starting with # are comments.
 */
async function fetchUrlhausDomains() {
  console.log("  Fetching URLhaus feed...");
  try {
    const res = await fetchWithTimeout(URLHAUS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await readTextWithLimit(res);

    const domains = new Set();
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      // CSV fields are quoted; extract the URL field (3rd column, index 2)
      const match = line.match(/"([^"]*)"(?:,"([^"]*)")*?/g);
      if (!match || match.length < 3) continue;
      const urlField = match[2]?.replace(/"/g, "");
      if (!urlField) continue;
      try {
        const u = new URL(urlField);
        const host = u.hostname.toLowerCase();
        if (host && !host.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
          domains.add(host);
          // Also insert the base (registrable) domain so runtime checks
          // using getRegistrableDomain() can find it.
          const base = getBaseDomain(host);
          if (base !== host) domains.add(base);
        }
      } catch {
        // skip invalid URLs
      }
    }

    console.log(`  URLhaus: ${domains.size} unique domains (including base domains)`);
    return domains;
  } catch (err) {
    console.warn(`  URLhaus fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Set();
  }
}

/**
 * Extract domains from OpenPhish community feed (plain text, one URL per line).
 */
async function fetchOpenPhishDomains() {
  console.log("  Fetching OpenPhish feed...");
  try {
    const res = await fetchWithTimeout(OPENPHISH_FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await readTextWithLimit(res);

    const domains = new Set();
    for (const line of text.split("\n")) {
      const url = line.trim();
      if (!url) continue;
      try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host && !host.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
          domains.add(host);
          const base = getBaseDomain(host);
          if (base !== host) domains.add(base);
        }
      } catch {
        // skip invalid URLs
      }
    }

    console.log(`  OpenPhish: ${domains.size} unique domains (including base domains)`);
    return domains;
  } catch (err) {
    console.warn(`  OpenPhish fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Size budget
// ---------------------------------------------------------------------------

const SIZE_BUDGET_BYTES = 150 * 1024; // 150KB
const TARGET_FP_RATE = 0.0001; // 0.01%

// ---------------------------------------------------------------------------
// Fail-closed guards (#322 / disc#12, disc#13)
// ---------------------------------------------------------------------------

/**
 * The PRODUCTION builder must never silently ship a test/placeholder filter:
 * if both feeds yield zero domains it must FAIL, not fall back to a handful of
 * `.example` test domains (that is what scripts/build-test-bloom-filter.mjs is
 * for). Shipping a 15-domain filter leaves `isKnownBadDomain` matching nothing
 * real while `reputationReady()` reports true. (#321 / disc#12)
 */
export function assertFeedsProducedDomains(count) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(
      `No domains fetched from any feed (count=${count}). Refusing to build a ` +
        `placeholder reputation filter — fix the feeds or use ` +
        `\`npm run build:bloom:test\` for intentional test data.`,
    );
  }
}

/**
 * Fail closed when the filter exceeds the size budget instead of writing an
 * oversized artifact (the runtime caps reads at MAX_REPUTATION_FILE_BYTES, so an
 * over-budget filter would be silently rejected at load). (#322 / disc#13)
 */
export function assertWithinBudget(filterSizeBytes, budgetBytes) {
  if (filterSizeBytes > budgetBytes) {
    throw new Error(
      `Filter size ${(filterSizeBytes / 1024).toFixed(1)} KB exceeds budget ` +
        `${(budgetBytes / 1024).toFixed(0)} KB — raise TARGET_FP_RATE or reduce the domain set.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Building bloom filter for domain reputation...\n");

  // Fetch domains from feeds
  const [urlhausDomains, openPhishDomains] = await Promise.all([
    fetchUrlhausDomains(),
    fetchOpenPhishDomains(),
  ]);

  // Merge all domains
  const allDomains = new Set([...urlhausDomains, ...openPhishDomains]);

  // Fail closed: the production builder must not ship a placeholder filter. (#321/disc#12)
  assertFeedsProducedDomains(allDomains.size);

  console.log(`\nTotal unique domains: ${allDomains.size}`);

  // Calculate optimal bloom filter parameters
  const { m, k } = optimalParams(allDomains.size, TARGET_FP_RATE);
  const filterSizeBytes = HEADER_SIZE + Math.ceil(m / 8);

  console.log(`Bloom filter parameters: m=${m} bits, k=${k} hash functions`);
  console.log(
    `Estimated filter size: ${(filterSizeBytes / 1024).toFixed(1)} KB`
  );

  // Fail closed on budget overflow rather than writing an oversized artifact. (disc#13)
  assertWithinBudget(filterSizeBytes, SIZE_BUDGET_BYTES);

  // Build the filter
  const filter = createFilter(m, k);
  for (const domain of allDomains) {
    insertDomain(filter, domain);
  }

  // Serialize and write
  const binary = serializeFilter(filter);
  writeFileSync(OUT_PATH, binary);

  console.log(`\nWrote bloom filter to: ${OUT_PATH}`);
  console.log(`  File size: ${(binary.length / 1024).toFixed(1)} KB`);
  console.log(`  Domains: ${allDomains.size}`);
  console.log(`  Hash functions (k): ${k}`);
  console.log(`  Bits (m): ${m}`);
  console.log(`  Target FP rate: ${(TARGET_FP_RATE * 100).toFixed(4)}%`);
}

// Only run when invoked directly, so tests can import the guards without fetching. (#322)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
