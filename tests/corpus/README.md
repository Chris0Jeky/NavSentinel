# Real-World Phishing Test Corpus

Infrastructure intended to test NavSentinel against snapshots of real phishing
pages. It does not currently produce a claim-grade true-positive rate: real-host
replay and trusted-input mechanics are implemented and synthetic-contract
verified, but headed owner validation and efficacy gates remain
pending/`INVALID`.

## How it works

1. **Fetch snapshots** from public phishing feeds (OpenPhish, PhishTank) and emit a versioned manifest with deterministic filenames, byte sizes, and SHA-256 digests.
2. **Replay each validated byte buffer** at its recorded canonical URL through a
   static route response; scripts and all unarmed subresources are blocked.
3. **Load the page** in Chromium with NavSentinel installed.
4. **Exercise one eligible control** with native Playwright input, then observe
   protection signals separately from the one-use first-hop harm receipt.
5. **Report** protected, fired-late, miss, and not-exercisable outcomes only
   when the complete replay denominator remains valid.

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
| `tests/corpus/validation-results.json` | Complete-run receipt or `TEST_INVALID` record (gitignored) |
| `tests/e2e/corpus_replay_harness.ts` | Shared canonical-URL replay, native-input, route, and receipt harness |
| `tests/e2e/corpus-validation.spec.ts` | Playwright runner that records corpus outcomes |
| `playwright.corpus.config.ts` | Playwright config for corpus tests |

## What the output means

The runner writes a structured receipt with the complete replay denominator:

- **Protected**: a qualifying block or prompt stopped the selected action before
  the independent harm receipt.
- **Fired**: NavSentinel emitted a qualifying signal, but the selected action
  still reached the receipt or the signal was post-render only.
- **Miss**: an actionable control reached the receipt without a qualifying
  product signal.
- **Not exercisable**: no supported, visible, enabled control was available;
  this remains in the replay denominator but not the actionable denominator.
- **Rates**: protected per replay entry, protected per actionable entry, and
  harm reached per actionable entry.

If readiness, routing, trusted input, signal collection, cleanup, or denominator
completion fails, the whole receipt is `TEST_INVALID` and rates are `null`.
Partial observations never become a partial rate.

## Important notes

`npm run test:e2e:corpus:contract` needs no owner-held corpus input. It is
mechanics-only and uses inert HTML at exact HTTPS `.test` URLs, including a
blocked inline-script sentinel, in-memory route fulfilment, an empty-allowlist
egress fence, full readiness checks, and Playwright-native input. It exercises
the shared route/input/receipt path with synthetic reserved domains. It does not
validate an owner corpus run, a committed manifest/result, efficacy, or Gate-3;
those remain `INVALID`/unproven. Static replay does not execute snapshot
JavaScript.

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
  manifest or validation results are committed. The runner now replays each
  digest-validated snapshot byte-for-byte at its recorded canonical URL and
  uses native Playwright input. It permits only a one-use inert route receipt
  armed from the selected control; all other page HTTP(S) is denied by routes
  and an empty-allowlist proxy. GET-form query serialization remains explicitly
  path-bound rather than exact-query replay. Popup forms and links whose opener
  identity cannot be preserved are reported as not exercisable. This does not
  establish corpus validity, efficacy, owner-headed validation, or Gate-3.
  Static replay leaves snapshot JavaScript execution unimplemented; a headed
  owner run, committed owner-curated result, and efficacy evidence remain
  pending/`INVALID` under #417.
- **Feeds are free** — no API keys required. OpenPhish and PhishTank provide
  public feeds of verified phishing URLs.
- **Pages may be down** — phishing pages are taken down quickly. The fetch script
  handles errors gracefully and records which URLs could not be downloaded.
