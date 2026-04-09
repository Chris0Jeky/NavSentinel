# False Positive Measurement Results

This directory holds output from the NavSentinel false positive measurement
script (`scripts/measure-fp.mjs`). Result CSV files are gitignored because
they are large and machine-specific.

## Quick start

```bash
# Build the extension first
npm run build

# Run the measurement (visits Tranco top-1000, takes 30-60 min)
npm run measure:fp

# Test with fewer sites first
npm run measure:fp -- --sites 20

# Run headed (visible browser)
npm run measure:fp -- --headed --sites 50

# Resume an interrupted run
npm run measure:fp -- --resume --out tests/fp-results/report-PREVIOUS.csv
```

## What it does

1. Downloads the current Tranco top-1000 list (cached for 24 hours).
2. Launches Chromium with the NavSentinel extension loaded.
3. For each site: navigates to the homepage, scrolls, clicks up to 3
   internal links, and waits for the extension to settle.
4. After each site, reads the NavSentinel event log from
   `chrome.storage.local` and records any prompts, blocks, or warnings.
5. Outputs a CSV report with one row per site (or per event, if NavSentinel
   fired).

## CSV columns

| Column            | Description                                           |
|-------------------|-------------------------------------------------------|
| `rank`            | Tranco ranking (1 = most popular)                     |
| `domain`          | Domain name from the Tranco list                      |
| `url_visited`     | Actual URL visited (after redirects)                  |
| `action`          | `none`, `false_positive`, `expected`, `error`, `harness_error` |
| `ns_event_kind`   | NavSentinel event kind (e.g. `nav_blank_prompt`)      |
| `ns_event_site`   | Site field from the event                             |
| `ns_event_score`  | CDS score from the event                              |
| `ns_event_reasons`| Semicolon-separated scoring reasons                   |
| `is_false_positive` | `yes` if the event represents a false positive      |
| `error`           | Error message if the site could not be tested         |

## Interpreting results

- **Target**: < 0.1% false positive rate (fewer than 1 in 1000 sites).
- **`action=none`**: No NavSentinel events fired. Expected for legitimate sites.
- **`action=false_positive`**: NavSentinel triggered on a legitimate site. These
  need investigation — check the `ns_event_kind` and `ns_event_reasons` columns
  to understand why.
- **`action=error`**: Site was unreachable or timed out. These are excluded from
  the FP rate calculation.
- **`action=expected`**: NavSentinel fired but the event kind is not one that
  would be a false positive (e.g. config updates).

## Limitations

- Only visits the homepage and up to 3 internal links per site. False positives
  on deep pages may be missed.
- Does not fill in forms or interact with login flows — credential guard FPs
  require separate targeted testing.
- Some sites block automated browsers or require CAPTCHA, which will show up
  as errors rather than FPs.
- The Tranco list is a snapshot; site behavior changes over time.
