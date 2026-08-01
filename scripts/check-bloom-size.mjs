/**
 * Checks the bloom filter binary: structural header validity AND size budget.
 *
 * Usage:
 *   node scripts/check-bloom-size.mjs [path]
 *
 * Arguments:
 *   path  Path to the bloom filter binary.
 *         Default: extension/public/reputation_data.bin
 *
 * Exits 0 if the file exists, has a valid header, and is within the 2 MB limit.
 * Exits 1 if the file is missing, structurally invalid, or exceeds the limit.
 *
 * The size limit here is the runtime SAFETY cap (MAX_REPUTATION_FILE_BYTES in
 * reputation_runtime.enabled.ts); the tighter ~150 KB research budget is enforced at build time by
 * build-bloom-filter.mjs (assertWithinBudget). (#10 — whether to also gate the
 * design budget here is coupled to the real-filter sizing in #321.)
 */

import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB = 2,097,152 bytes (runtime safety cap)
const HEADER_SIZE = 16;
const HEADER_MAGIC = 0x424c4f4d; // "BLOM"
const HEADER_VERSION = 1;
// Mirror reputation.ts loadFilter's caps (the .mjs can't import the .ts at runtime),
// so the CI gate accepts exactly what the runtime accepts.
const MIN_FILTER_BITS = 8; // sub-byte m is degenerate
const MAX_FILTER_BITS = 16 * 1024 * 1024; // 16 Mbit OOM/CPU-lock safety cap
const MAX_HASH_FUNCTIONS = 30;

/**
 * Validate the bloom filter binary's header and structural consistency.
 * A zeroed/corrupt/truncated file passes a bare size check but is non-functional
 * at runtime; fail closed instead. Returns {m, k} on success, throws otherwise. (#11)
 */
export function validateBloomBinary(buf) {
  if (!buf || buf.length < HEADER_SIZE) {
    throw new Error(`Bloom filter too small for a ${HEADER_SIZE}-byte header (got ${buf ? buf.length : 0} bytes)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== HEADER_MAGIC) {
    throw new Error(`Invalid bloom filter magic: 0x${magic.toString(16)} (expected 0x${HEADER_MAGIC.toString(16)})`);
  }
  const version = view.getUint32(4, true);
  if (version !== HEADER_VERSION) {
    throw new Error(`Unsupported bloom filter version: ${version} (expected ${HEADER_VERSION})`);
  }
  const k = view.getUint32(8, true);
  const m = view.getUint32(12, true);
  if (k < 1) {
    throw new Error(`Degenerate bloom filter: k=${k} (must be >= 1)`);
  }
  if (k > MAX_HASH_FUNCTIONS) {
    throw new Error(`Bloom filter k=${k} exceeds safety cap of ${MAX_HASH_FUNCTIONS} (would be rejected at runtime)`);
  }
  if (m < MIN_FILTER_BITS) {
    throw new Error(`Degenerate bloom filter: m=${m} bits (must be >= ${MIN_FILTER_BITS})`);
  }
  if (m > MAX_FILTER_BITS) {
    throw new Error(`Bloom filter m=${m} bits exceeds safety cap of ${MAX_FILTER_BITS} (would be rejected at runtime)`);
  }
  const expected = HEADER_SIZE + Math.ceil(m / 8);
  if (buf.length !== expected) {
    throw new Error(`Bloom filter size mismatch: header says m=${m} (=> ${expected} bytes) but file is ${buf.length} bytes (truncated or trailing garbage?)`);
  }
  return { m, k };
}

function main() {
  const filePath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(__dirname, "..", "extension", "public", "reputation_data.bin");

  console.log(`Checking bloom filter: ${filePath}`);
  console.log(`Size limit: ${MAX_SIZE_BYTES.toLocaleString()} bytes (2 MB)\n`);

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    console.error(`ERROR: File not found: ${filePath}`);
    process.exit(1);
  }
  if (!stat.isFile()) {
    console.error(`ERROR: Path is not a regular file: ${filePath}`);
    process.exit(1);
  }

  const buf = readFileSync(filePath);
  try {
    const { m, k } = validateBloomBinary(buf);
    console.log(`Header OK: m=${m} bits, k=${k} hash functions.`);
  } catch (err) {
    console.error(`\nFAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const sizeBytes = buf.length;
  console.log(`File size: ${sizeBytes.toLocaleString()} bytes (${(sizeBytes / 1024).toFixed(2)} KB)`);

  if (sizeBytes > MAX_SIZE_BYTES) {
    console.error(
      `\nFAIL: Bloom filter exceeds 2 MB limit by ${(sizeBytes - MAX_SIZE_BYTES).toLocaleString()} bytes.`,
    );
    console.error("Consider increasing the target false-positive rate or reducing the domain count.");
    process.exit(1);
  }

  console.log("\nPASS: Bloom filter has a valid header and is within the 2 MB size budget.");
}

// Only run when invoked directly, so tests can import validateBloomBinary. (#322)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
