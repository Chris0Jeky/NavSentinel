---
name: False Positive Report
about: Report a site incorrectly flagged by NavSentinel
labels: false-positive
---

## Website URL

The URL where the false positive occurred.

## What action triggered the warning

Describe the link click, redirect, or form submission that caused NavSentinel
to show a warning (e.g. "Clicked a navigation link on the homepage").

## NavSentinel mode

- **Navigation guard mode:** [smart / strict / off]
- **Credential guard mode:** [smart / strict / off]

## Extension version

[e.g. 0.5.0]

## Expected behavior

Describe why this should not have triggered a warning. For example:
"This is a normal navigation link on a trusted site."

## Scores (from debug overlay)

If the debug overlay is enabled, please provide the scores shown:

- **NRS (Navigation Risk Score):** [e.g. 0.85]
- **CDS (Credential Danger Score):** [e.g. 0.40]

## Screenshots of the warning shown

If possible, include a screenshot of the NavSentinel warning dialog or
overlay that appeared. The debug overlay scores (NRS, CDS) are especially
helpful for diagnosing threshold issues.
