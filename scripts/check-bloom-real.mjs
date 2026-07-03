/**
 * Release-only guard: refuse to SHIP the placeholder/test bloom filter.
 *
 * The production reputation filter (URLhaus + OpenPhish, built by
 * `scripts/build-bloom-filter.mjs`) encodes tens of thousands of domains, so its
 * bit array `m` is in the millions. The placeholder committed to the repo
 * (`scripts/build-test-bloom-filter.mjs`, 15 reserved `.example` domains) has
 * m ~= 300 bits. Shipping that placeholder while README / PRIVACY / SECURITY /
 * the store listing describe threat-feed protection is exactly the drift #423
 * corrected — this guard makes it impossible to *release* it.
 *
 * Runs in `scripts/release.mjs` and the tag-triggered CI `release` job ONLY, NOT
 * in per-PR CI (which legitimately still ships the placeholder on `main` until
 * the real feed is built). Building the real filter is AI-9 / issue #321; this
 * is its companion enforcement (#321 / #322 build-script fail-closed cluster).
 *
 * Usage:
 *   node scripts/check-bloom-real.mjs [path]
 * Env:
 *   NAVSENTINEL_ALLOW_TEST_BLOOM=1   downgrade the hard failure to a warning
 *                                    (documented escape hatch; do not use for a
 *                                    real public release).
 *
 * Exits 0 if the shipped filter looks like a production feed (or the override is
 * set); exits 1 if it is the placeholder, missing, or structurally invalid.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBloomBinary } from "./check-bloom-size.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The placeholder test filter is ~300 bits; any production threat-feed filter
// (tens of thousands of domains) is far above this. A real number is coupled to
// #321's real-filter sizing — this floor only needs to sit unambiguously between
// the 15-domain test stub and a genuine feed, with generous headroom on both
// sides. (Mirrors the check-bloom-size.mjs coupling note.)
export const MIN_REAL_FILTER_BITS = 100_000;

/**
 * Validate the header and classify a bloom binary as a real (production) filter
 * vs the placeholder/test filter. Returns { real, m, k }. Throws (via
 * validateBloomBinary) if the header itself is missing/corrupt/truncated.
 */
export function inspectBloomFilter(buf) {
  const { m, k } = validateBloomBinary(buf);
  return { real: m >= MIN_REAL_FILTER_BITS, m, k };
}

function main() {
  const filePath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(__dirname, "..", "extension", "public", "reputation_data.bin");
  const allowTest = process.env.NAVSENTINEL_ALLOW_TEST_BLOOM === "1";

  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    console.error(`FAIL: reputation filter not found: ${filePath}`);
    process.exit(1);
  }

  let info;
  try {
    info = inspectBloomFilter(buf);
  } catch (err) {
    console.error(`FAIL: invalid bloom filter header: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`Reputation filter: ${filePath}`);
  console.log(`  m=${info.m} bits, k=${info.k}; real-filter floor=${MIN_REAL_FILTER_BITS} bits`);

  if (info.real) {
    console.log("PASS: shipped bloom filter looks like a production threat-feed filter.");
    return;
  }

  const msg =
    `shipped reputation_data.bin is not a production threat-feed filter (m=${info.m} bits < ${MIN_REAL_FILTER_BITS} floor). ` +
    `Build/rebuild the real feed with 'npm run build:bloom' before releasing — the committed default is a placeholder, ` +
    `and a below-floor filter can also mean a threat feed failed at build time (issue #321 / AI-9).`;
  if (allowTest) {
    console.warn(`WARNING (NAVSENTINEL_ALLOW_TEST_BLOOM=1): ${msg}`);
    return;
  }
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

// Only run when invoked directly, so tests can import inspectBloomFilter without
// stat/reading the committed file. (mirrors check-bloom-size.mjs / #322)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
