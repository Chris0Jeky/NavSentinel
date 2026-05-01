#!/usr/bin/env node
/**
 * Generates a small deterministic bloom filter for unit testing.
 * This avoids depending on external feeds for test execution.
 *
 * Outputs to: extension/public/reputation_data.bin
 *
 * Usage: node scripts/build-test-bloom-filter.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(
  __dirname,
  "..",
  "extension",
  "public",
  "reputation_data.bin"
);

// ---------------------------------------------------------------------------
// Bloom filter primitives (same as build-bloom-filter.mjs)
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

function optimalParams(n, p) {
  if (n <= 0) return { m: 8, k: 1 };
  const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

function createFilter(m, k) {
  return { bits: new Uint8Array(Math.ceil(m / 8)), m, k };
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
// Test domains
// ---------------------------------------------------------------------------

const TEST_BAD_DOMAINS = [
  "evil-phishing-test.example",
  "malware-dropper-test.example",
  "fake-login-test.example",
  "credential-harvest-test.example",
  "scam-redirect-test.example",
  "phishing-kit-test.example",
  "exploit-kit-test.example",
  "ransomware-delivery-test.example",
  "banking-trojan-test.example",
  "tech-support-scam-test.example",
  "fake-antivirus-test.example",
  "sms-phishing-test.example",
  "oauth-abuse-test.example",
  "clickjacking-test.example",
  "drive-by-download-test.example",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { m, k } = optimalParams(TEST_BAD_DOMAINS.length, 0.0001);
const filter = createFilter(m, k);

for (const domain of TEST_BAD_DOMAINS) {
  insertDomain(filter, domain);
}

const binary = serializeFilter(filter);
writeFileSync(OUT_PATH, binary);

console.log(`Wrote test bloom filter: ${OUT_PATH}`);
console.log(`  Domains: ${TEST_BAD_DOMAINS.length}`);
console.log(`  Size: ${binary.length} bytes`);
console.log(`  k=${k}, m=${m}`);
