#!/usr/bin/env node
/**
 * Build Brand Templates (P4-01 W3-03)
 *
 * Generates the brand_templates.json file from source screenshots.
 * In production, this would process actual login page screenshots.
 * For now, it generates deterministic placeholder hashes derived from
 * brand identifiers (seeded PRNG) so the pipeline is fully testable.
 *
 * Usage: node scripts/build-brand-templates.mjs
 * Output: extension/public/brand_templates.json
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../extension/public/brand_templates.json");

const BRANDS = [
  // Email
  { id: "google", displayName: "Google Sign-In" },
  { id: "microsoft", displayName: "Microsoft Sign-In" },
  { id: "yahoo", displayName: "Yahoo Mail" },
  { id: "protonmail", displayName: "Proton Mail" },
  // Social
  { id: "facebook", displayName: "Facebook Login" },
  { id: "twitter", displayName: "X (Twitter)" },
  { id: "instagram", displayName: "Instagram" },
  { id: "linkedin", displayName: "LinkedIn" },
  { id: "tiktok", displayName: "TikTok" },
  // Banking
  { id: "chase", displayName: "Chase Online" },
  { id: "bankofamerica", displayName: "Bank of America" },
  { id: "wellsfargo", displayName: "Wells Fargo" },
  { id: "citi", displayName: "Citibank" },
  { id: "capitalone", displayName: "Capital One" },
  { id: "hsbc", displayName: "HSBC" },
  { id: "barclays", displayName: "Barclays" },
  // E-commerce
  { id: "amazon", displayName: "Amazon Sign-In" },
  { id: "ebay", displayName: "eBay" },
  { id: "paypal", displayName: "PayPal" },
  { id: "stripe", displayName: "Stripe Dashboard" },
  // Cloud
  { id: "aws", displayName: "AWS Console" },
  { id: "azure", displayName: "Azure Portal" },
  { id: "gcp", displayName: "Google Cloud" },
  { id: "cloudflare", displayName: "Cloudflare" },
  { id: "digitalocean", displayName: "DigitalOcean" },
  // Crypto
  { id: "coinbase", displayName: "Coinbase" },
  { id: "binance", displayName: "Binance" },
  { id: "kraken", displayName: "Kraken" },
  { id: "metamask", displayName: "MetaMask" },
  // Dev
  { id: "github", displayName: "GitHub" },
  { id: "gitlab", displayName: "GitLab" },
  { id: "bitbucket", displayName: "Bitbucket" },
  { id: "npm", displayName: "npm" },
  // Enterprise
  { id: "salesforce", displayName: "Salesforce" },
  { id: "okta", displayName: "Okta" },
  { id: "duo", displayName: "Duo Security" },
  { id: "workday", displayName: "Workday" },
  // Telecom
  { id: "att", displayName: "AT&T" },
  { id: "verizon", displayName: "Verizon" },
  { id: "tmobile", displayName: "T-Mobile" },
  // Streaming
  { id: "netflix", displayName: "Netflix" },
  { id: "spotify", displayName: "Spotify" },
  { id: "apple", displayName: "Apple ID" },
  // Misc
  { id: "dropbox", displayName: "Dropbox" },
  { id: "zoom", displayName: "Zoom" },
  { id: "slack", displayName: "Slack" },
  { id: "discord", displayName: "Discord" },
];

/**
 * Generate a deterministic 8-byte aHash from a brand ID.
 * Uses SHA-256 of the brand ID as a seed, takes first 8 bytes.
 * In production, this would be computed from actual screenshots.
 */
function generateAHash(brandId) {
  const hash = createHash("sha256").update(`ahash:${brandId}:v1`).digest();
  return Array.from(hash.subarray(0, 8));
}

/**
 * Generate a deterministic 32-byte bHash from a brand ID.
 * Uses SHA-256 of the brand ID as a seed, repeated to fill 32 bytes.
 * In production, this would be computed from actual screenshots.
 */
function generateBHash(brandId) {
  const hash1 = createHash("sha256").update(`bhash:${brandId}:v1`).digest();
  return Array.from(hash1);
}

const templates = BRANDS.map((brand) => ({
  id: brand.id,
  displayName: brand.displayName,
  aHash: generateAHash(brand.id),
  bHash: generateBHash(brand.id),
  version: 1,
}));

const output = JSON.stringify({ version: 1, generated: new Date().toISOString().split("T")[0], templates }, null, 2);

writeFileSync(OUTPUT_PATH, output, "utf-8");
console.log(`Generated ${templates.length} brand templates -> ${OUTPUT_PATH}`);
console.log(`File size: ${Buffer.byteLength(output)} bytes`);
