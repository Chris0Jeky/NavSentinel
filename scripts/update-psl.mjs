#!/usr/bin/env node
/**
 * Fetches the Public Suffix List and compiles it into a JSON trie
 * stored at extension/src/shared/psl_data.json.
 *
 * Trie encoding:
 *   Each node is { [label]: childNode }.
 *   A child key of "" (empty string) with value 1 marks "this path is a public suffix".
 *   A child key of "*" means "any label matches here" (wildcard rule).
 *   A child key of "!" means "exception — this label is NOT a public suffix despite a
 *     wildcard at the same level".  Exception nodes store their concrete labels as keys.
 *
 * Usage:  node scripts/update-psl.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "extension", "src", "shared", "psl_data.json");

async function fetchPSL() {
  const res = await fetch(PSL_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch PSL: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parsePSL(text) {
  const rules = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Skip blanks and comments
    if (!line || line.startsWith("//")) continue;

    let type = "exact";
    let rule = line;

    if (rule.startsWith("!")) {
      type = "exception";
      rule = rule.slice(1);
    } else if (rule.startsWith("*.")) {
      type = "wildcard";
      rule = rule.slice(2); // keep the base (e.g. "ck" from "*.ck")
    }

    const labels = rule.split(".").reverse(); // TLD first
    rules.push({ type, labels });
  }

  return rules;
}

function buildTrie(rules) {
  const root = {};

  for (const { type, labels } of rules) {
    let node = root;

    for (const label of labels) {
      if (node[label] === undefined) {
        node[label] = {};
      }
      node = node[label];
    }

    if (type === "exact") {
      // Mark this node as a public suffix endpoint
      node[""] = 1;
    } else if (type === "wildcard") {
      // Add a wildcard child: any label at the next level is a public suffix
      if (node["*"] === undefined) {
        node["*"] = {};
      }
      node["*"][""] = 1;
    } else if (type === "exception") {
      // Exception: the last label in `labels` is the exception label.
      // We mark it by adding a "!" entry on the *parent* of the excepted label.
      // Actually, for exceptions like "!www.ck" parsed as labels=["ck","www"],
      // we need to navigate to "ck" then mark "www" as an exception.
      // The loop already navigated to the deepest node (the "www" node under "ck").
      // We mark this deepest node with a special "!" flag.
      node["!"] = 1;
    }
  }

  return root;
}

async function main() {
  console.log("Fetching Public Suffix List...");
  const text = await fetchPSL();
  console.log("Parsing rules...");
  const rules = parsePSL(text);
  console.log(`Parsed ${rules.length} rules.`);

  console.log("Building trie...");
  const trie = buildTrie(rules);

  const json = JSON.stringify(trie);
  writeFileSync(OUT_PATH, json + "\n", "utf-8");
  const sizeKB = (Buffer.byteLength(json, "utf-8") / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${sizeKB} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
