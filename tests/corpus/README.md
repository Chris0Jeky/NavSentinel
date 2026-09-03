# Real-World Phishing Test Corpus

Infrastructure intended to test NavSentinel against snapshots of real phishing
pages. It does not currently produce a claim-grade true-positive rate: #417's
real-host routing, trusted input, headed validation, and efficacy gates remain
pending/`INVALID`.

## How it works

1. **Fetch snapshots** from public phishing feeds (OpenPhish, PhishTank) and emit a versioned manifest with deterministic filenames, byte sizes, and SHA-256 digests.
2. **Serve each snapshot** locally via a test HTTP server.
3. **Load the page** in Chromium with NavSentinel installed.
4. **Record detections** — nav prompts, credential warnings, rollbacks.
5. **Report** true positive rate, false negatives, and per-page details.

## Quick start

```bash
# Build the extension first
npm run build

# Fetch phishing page snapshots (default: 50 pages)
node scripts/fetch-phishing-corpus.mjs

# Fetch more pages
node scripts/fetch-phishing-corpus.mjs --limit 100

# Dry run — fetch URLs only, no downloads
node scripts/fetch-phishing-corpus.mjs --dry-run

# Rehydrate a supplied manifest into a new absent directory without feed calls.
# The command verifies every downloaded byte before atomically publishing output.
node scripts/fetch-phishing-corpus.mjs --from-manifest path/to/manifest.json --output-dir path/to/new-snapshots

# Run the corpus validation test
npm run test:e2e:corpus
```

## Files

| Path | Description |
|------|-------------|
| `scripts/fetch-phishing-corpus.mjs` | Downloads phishing page snapshots |
| `tests/corpus/manifest.json` | Versioned snapshot metadata and byte digests (gitignored) |
| `tests/corpus/snapshots/` | Downloaded HTML files (gitignored) |
| `tests/e2e/corpus-validation.spec.ts` | Playwright test that validates detection |
| `playwright.corpus.config.ts` | Playwright config for corpus tests |

## What the output means

The test outputs a summary table:

- **Total tested**: Number of snapshots successfully loaded.
- **True positives (TP)**: NavSentinel detected something suspicious.
- **False negatives (FN)**: NavSentinel did not detect anything.
- **Detection rate**: TP / (TP + FN) as a percentage.

A detection counts as a true positive if NavSentinel fires any event
(nav prompt, credential warning, popup block, redirect rollback, etc.)
on a page sourced from a known-phishing feed.

## Important notes

- **Snapshots are not committed** — they contain third-party HTML from phishing
  pages and are gitignored. You must run `fetch-phishing-corpus.mjs` locally.
  The generated manifest uses `schema_version: "1.0.0"`; every successful entry
  has a deterministic filename, exact byte size, and lowercase SHA-256 digest.
- **Corpus input fails closed** — the validation lane rejects missing, malformed,
  empty, unsafe, or byte-mismatched manifests/snapshots as `TEST_INVALID`; it
  never silently filters invalid entries. Failed downloads are retained only as
  validated `download_failed` accounting records and are not testable snapshots.
- **Feed preflight is count-only and conservative** — incoming candidates must
  have a known source and an exact, credential-free, fragment-free HTTP(S) URL.
  Unsafe rows are quarantined and canonical duplicates are removed before the
  existing randomized selection and limit. Preflight logs report counts without
  candidate URLs.
- **Rehydration is feed-independent and atomic** — `--from-manifest` requires
  `--output-dir`, never rewrites the input manifest, rejects an existing output
  directory, rejects redirects, and publishes the requested directory only after
  every successful manifest record has exact size and digest validation. It is
  unit-testable with an injected transport; it does not make an offline corpus
  result claim. Rehydration makes outbound requests to the recorded targets, so
  run it only with a reviewed, owner-controlled manifest.
- **This is contract support, not a valid corpus result** — no real corpus
  manifest or validation results are committed. Real-host routing, trusted input,
  a headed run, a committed owner-curated result, and efficacy evidence remain
  pending/`INVALID` under #417. The current local-server/synthetic-input
  methodology must not be used to claim a true-positive rate.
- **Feeds are free** — no API keys required. OpenPhish and PhishTank provide
  public feeds of verified phishing URLs.
- **Pages may be down** — phishing pages are taken down quickly. The fetch script
  handles errors gracefully and records which URLs could not be downloaded.
