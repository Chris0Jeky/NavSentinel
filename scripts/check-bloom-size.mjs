#!/usr/bin/env node
/**
 * Checks that the bloom filter binary does not exceed the size budget.
 *
 * Usage:
 *   node scripts/check-bloom-size.mjs [path]
 *
 * Arguments:
 *   path  Path to the bloom filter binary.
 *         Default: extension/public/reputation_data.bin
 *
 * Exits 0 if the file exists and is within the 2 MB limit.
 * Exits 1 if the file is missing or exceeds the limit.
 */

import { statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB = 2,097,152 bytes

const filePath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(__dirname, "..", "extension", "public", "reputation_data.bin");

console.log(`Checking bloom filter size: ${filePath}`);
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

const sizeBytes = stat.size;
const sizeKB = (sizeBytes / 1024).toFixed(2);

console.log(`File size: ${sizeBytes.toLocaleString()} bytes (${sizeKB} KB)`);

if (sizeBytes > MAX_SIZE_BYTES) {
  console.error(
    `\nFAIL: Bloom filter exceeds 2 MB limit by ${(sizeBytes - MAX_SIZE_BYTES).toLocaleString()} bytes.`
  );
  console.error(
    "Consider increasing the target false-positive rate or reducing the domain count."
  );
  process.exit(1);
}

console.log("\nPASS: Bloom filter is within the 2 MB size budget.");
