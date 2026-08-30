/**
 * Fetches the Public Suffix List and compiles it into a JSON trie
 * stored at extension/src/shared/psl_data.json.
 *
 * Trie encoding:
 *   Each node is { [label]: childNode }.
 *   A child key of "" (empty string) with value 1 marks "this path is a public suffix".
 *   A leaf public suffix is compacted to the scalar value 1 instead of {"":1}.
 *   A child key of "*" means "any label matches here" (wildcard rule).
 *   A child key of "!" means "exception — this label is NOT a public suffix despite a
 *     wildcard at the same level".  Exception nodes store their concrete labels as keys.
 *
 * Usage:  node scripts/update-psl.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "extension", "src", "shared", "psl_data.json");

// The real PSL has ~9,000+ rules. A successful HTTP 200 can still return an empty
// or truncated body (CDN hiccup, partial transfer); parsePSL("") yields [] and
// buildTrie([]) yields {}, which would overwrite the committed psl_data.json with
// an empty trie -> getRegistrableDomain then returns TLD-only for every host,
// collapsing cross-registrant isolation for all multi-part ccTLDs (co.uk, com.au,
// ...). Fail closed: refuse to write a suspiciously small rule set. (#322 / disc#15)
export const MIN_PSL_RULES = 1000;

// A length-only sanity gate: parsePSL guarantees the element shape, so this
// guards against the truncated/empty-download failure mode (too few rules), not
// per-element corruption. Boundary is inclusive-low: exactly MIN_PSL_RULES passes;
// fewer rejects. buildTrie would still throw on a structurally bad element.
export function assertEnoughRules(rules) {
  if (!Array.isArray(rules) || rules.length < MIN_PSL_RULES) {
    throw new Error(
      `PSL too short: ${Array.isArray(rules) ? rules.length : "non-array"} rules ` +
        `(< ${MIN_PSL_RULES}) — refusing to overwrite psl_data.json (possible truncated download)`,
    );
  }
}

async function fetchPSL() {
  const res = await fetch(PSL_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch PSL: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export function parsePSL(text) {
  const rules = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    // Skip blanks and comments
    if (!line || line.startsWith("//")) continue;

    // PSL format: a rule is read only up to the first whitespace; any trailing content
    // on the line is an annotation. Truncating here is spec-correct AND turns a
    // stray-whitespace line like "a. .b" into "a." — an empty label the guard below
    // rejects. We deliberately do NOT charset-filter labels: the real PSL lists IDN
    // rules in UNICODE form (e.g. 公司, امارات, みんな — see the ~1k non-ASCII labels in
    // psl_data.json), so an ASCII-only [a-z0-9-] filter would reject thousands of valid
    // rules and break update:psl. The reserved-key/empty-label guard below catches the
    // labels that actually corrupt the trie. (#322 / #18)
    const firstToken = line.split(/\s/)[0];

    let type = "exact";
    let rule = firstToken;

    if (rule.startsWith("!")) {
      type = "exception";
      rule = rule.slice(1);
    } else if (rule.startsWith("*.")) {
      type = "wildcard";
      rule = rule.slice(2); // keep the base (e.g. "ck" from "*.ck")
    }

    const labels = rule.split(".").reverse(); // TLD first

    // Fail closed on malformed rules. The trie reserves three control keys: "" marks a
    // public-suffix endpoint, "*" marks a wildcard level, "!" marks an exception. A rule
    // whose labels include one of those (a bare "*" or "!", a stray non-leftmost "*",
    // a "*." with no base) or an empty label (a bare "!", "*.", or a ".."/leading-dot
    // line) would SILENTLY CORRUPT the compiled trie — e.g. a bare "*" lands as a
    // root-level wildcard that marks every TLD label a public suffix, breaking
    // registrable-domain computation (and therefore same-site / phishing decisions).
    // The real PSL never contains these; a feed that does is an anomaly we must not
    // ship, so we throw before buildTrie/write rather than emit a poisoned trie. (#322 / #18)
    for (const label of labels) {
      if (label === "" || label === "*" || label === "!") {
        throw new Error(
          `Malformed PSL rule (reserved or empty label ${JSON.stringify(label)}): ${JSON.stringify(line)}`,
        );
      }
    }

    rules.push({ type, labels });
  }

  return rules;
}

export function buildTrie(rules) {
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

  return compactTrie(root);
}

/** Replace only endpoint-only nodes with their equivalent scalar representation. */
function compactTrie(node) {
  for (const [label, child] of Object.entries(node)) {
    if (child && typeof child === "object") node[label] = compactTrie(child);
  }
  return Object.keys(node).length === 1 && node[""] === 1 ? 1 : node;
}

async function main() {
  console.log("Fetching Public Suffix List...");
  const text = await fetchPSL();
  console.log("Parsing rules...");
  const rules = parsePSL(text);
  console.log(`Parsed ${rules.length} rules.`);

  // Fail closed before touching the committed file (see assertEnoughRules / #322).
  assertEnoughRules(rules);

  console.log("Building trie...");
  const trie = buildTrie(rules);

  const json = JSON.stringify(trie);
  writeFileSync(OUT_PATH, json + "\n", "utf-8");
  const sizeKB = (Buffer.byteLength(json, "utf-8") / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${sizeKB} KB)`);
}

// Only run when invoked directly (`node scripts/update-psl.mjs`), so tests can
// import parsePSL / assertEnoughRules without triggering the network fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
