# Real-World Phishing Test Corpus

Infrastructure for testing NavSentinel against snapshots of real phishing pages.
This measures the extension's true positive rate on in-the-wild threats.

## How it works

1. **Fetch snapshots** from public phishing feeds (OpenPhish, PhishTank).
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

# Run the corpus validation test
npm run test:e2e:corpus
```

## Files

| Path | Description |
|------|-------------|
| `scripts/fetch-phishing-corpus.mjs` | Downloads phishing page snapshots |
| `tests/corpus/manifest.json` | Metadata for downloaded snapshots (gitignored) |
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
- **Tests require local snapshots** — the corpus validation spec skips if no
  manifest or snapshots exist. This means it will not run in CI by default.
- **Feeds are free** — no API keys required. OpenPhish and PhishTank provide
  public feeds of verified phishing URLs.
- **Pages may be down** — phishing pages are taken down quickly. The fetch script
  handles errors gracefully and records which URLs could not be downloaded.
