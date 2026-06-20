/**
 * Build a deterministic, filtered top-sites tier for NavSentinel.
 *
 * Default input is a checked-in starter seed. The same CSV shape can be fed by a
 * larger vetted Tranco/CrUX export later:
 *
 *   domain,tier,source,category,include_subdomains
 *   example.com,2,tranco,reference,false
 *
 * Banned categories are skipped at build time so raw popularity lists never
 * become an allowlist by accident.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const BANNED_CATEGORIES = new Set([
  "adult",
  "gambling",
  "hosting",
  "infrastructure",
  "parking",
  "piracy",
  "streaming",
  "user_content",
]);
const ALLOWED_CATEGORIES = new Set([
  "browser",
  "business",
  "cloud",
  "commerce",
  "developer",
  "identity",
  "payments",
  "productivity",
  "professional",
  "reference",
  "search",
  "software",
  "technology",
  "video_platform",
]);
const ALLOWED_HEADERS = new Set(["domain", "tier", "source", "category", "include_subdomains"]);
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,62}$/;

function normalizeDomain(domain) {
  return String(domain ?? "").trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Compare two domains by UTF-16 code-unit order — the SAME comparison the runtime
 * binary search uses (`candidate.domain < domain` in top_sites.ts findTopSiteEntry).
 *
 * localeCompare must NOT be used here: it is host-locale-dependent (Estonian collates
 * "z" before "t"; Lithuanian "y" between "i" and "k"), so a localeCompare sort run
 * under such a locale would emit the generated array in an order the runtime `<`
 * search does not expect, and a present top-site domain would become unfindable
 * (lookup misses -> trust tier silently lost). Code-unit comparison is deterministic
 * across hosts and matches the consumer exactly. (#322 / disc#17)
 */
export function compareTopSiteDomains(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveCliPath(arg, defaultRepoRelativePath) {
  return arg ? path.resolve(process.cwd(), arg) : path.resolve(repoRoot, defaultRepoRelativePath);
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (quoted) {
    throw new Error(`Unclosed quoted CSV field: ${line}`);
  }

  cells.push(cell.trim());
  return cells;
}

function parseIncludeSubdomains(value, domain) {
  const normalized = String(value ?? "false").trim().toLowerCase();
  if (normalized === "" || normalized === "false" || normalized === "0" || normalized === "no") return false;
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  throw new Error(`Invalid include_subdomains value for ${domain}: ${value}`);
}

function requireCell(cells, index, field, line) {
  const value = cells[index];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${field} in CSV row: ${line}`);
  }
  return value.trim();
}

function readEntries(inputPath) {
  const text = fs.readFileSync(inputPath, "utf8");
  const rows = text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (rows.length === 0) throw new Error(`No rows in ${path.relative(repoRoot, inputPath)}`);

  const header = parseCsvLine(rows[0]).map((cell) => cell.toLowerCase());
  const unsupportedHeaders = header.filter((cell) => !ALLOWED_HEADERS.has(cell));
  if (unsupportedHeaders.length > 0) {
    throw new Error(`Unsupported CSV column(s): ${unsupportedHeaders.join(", ")}`);
  }
  const domainIdx = header.indexOf("domain");
  const tierIdx = header.indexOf("tier");
  const categoryIdx = header.indexOf("category");
  const includeSubdomainsIdx = header.indexOf("include_subdomains");
  if (domainIdx < 0 || tierIdx < 0 || categoryIdx < 0) {
    throw new Error("CSV must include domain,tier,category columns");
  }

  const entries = new Map();
  for (const line of rows.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length !== header.length) {
      throw new Error(`CSV row has ${cells.length} columns, expected ${header.length}: ${line}`);
    }

    const domain = normalizeDomain(requireCell(cells, domainIdx, "domain", line));
    const tierText = requireCell(cells, tierIdx, "tier", line);
    const category = requireCell(cells, categoryIdx, "category", line).toLowerCase();
    const tier = Number(tierText);
    if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid domain: ${domain}`);
    if (!Number.isInteger(tier)) throw new Error(`Invalid tier for ${domain}: ${tierText}`);
    if (tier !== 2) continue;
    if (BANNED_CATEGORIES.has(category)) continue;
    if (!ALLOWED_CATEGORIES.has(category)) throw new Error(`Unsupported category for ${domain}: ${category}`);

    const includeSubdomains = includeSubdomainsIdx >= 0
      ? parseIncludeSubdomains(cells[includeSubdomainsIdx], domain)
      : false;
    // Fail closed: a duplicate domain in a trust seed must be an explicit error,
    // not a silent merge. The previous OR-merge let a second row quietly upgrade
    // includeSubdomains to true, which would widen exact-host trust to every
    // subdomain (e.g. attacker.github.com) without any reviewer noticing.
    if (entries.has(domain)) {
      throw new Error(`Duplicate domain in seed: ${domain}`);
    }
    entries.set(domain, {
      domain,
      includeSubdomains,
    });
  }
  // Sort by UTF-16 code-unit order so the generated array is valid for the runtime
  // binary search (see compareTopSiteDomains). (#322 / disc#17)
  return [...entries.values()].sort((a, b) => compareTopSiteDomains(a.domain, b.domain));
}

function render(entries) {
  const values = entries.map((entry) => {
    const fields = [`domain: ${JSON.stringify(entry.domain)}`];
    if (entry.includeSubdomains) fields.push("includeSubdomains: true");
    return `  { ${fields.join(", ")} },`;
  }).join("\n");
  return `/**\n` +
    ` * Generated by scripts/build-topsites-tier.mjs from data/top_sites.filtered.csv.\n` +
    ` * Starter seed only: keep the runtime code stable while the vetted Tranco/CrUX\n` +
    ` * export grows behind the same build-time interface.\n` +
    ` */\n` +
    `export const TOP_SITE_TIER_ENTRIES = [\n${values}\n] as const;\n`;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const args = process.argv.slice(2).filter((arg) => arg !== "--check");
  const inputPath = resolveCliPath(args[0], "data/top_sites.filtered.csv");
  const outputPath = resolveCliPath(args[1], "extension/src/shared/top_sites_data.ts");

  const entries = readEntries(inputPath);
  const rendered = render(entries);
  if (checkOnly) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (current !== rendered) {
      console.error(`${path.relative(repoRoot, outputPath)} is stale. Run npm run build:topsites.`);
      process.exit(1);
    }
    console.log(`${path.relative(repoRoot, outputPath)} is up to date (${entries.length} domains).`);
  } else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered, "utf8");
    console.log(`Wrote ${entries.length} filtered top-site domains to ${path.relative(repoRoot, outputPath)}`);
  }
}

// Only run when invoked directly (`node scripts/build-topsites-tier.mjs`), so tests
// can import compareTopSiteDomains without reading/writing any files. (#322)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
