# Privacy

NavSentinel is designed to be local-first.

## What The Extension Stores

In `chrome.storage.local`, the extension stores:

- suite settings
- navigation allowlist entries
- trusted credential domains
- a bounded local event log

The event log can include:

- event kind
- timestamp
- current site
- destination host
- risk score and reason codes
- small metadata fields related to the decision

## What The Extension Does Not Do

- no telemetry upload
- no background sync
- no cloud scoring
- no credential exfiltration
- no remote allowlist or reputation lookups

## Import And Export

The options page supports local JSON export and import of:

- settings
- allowlist
- trusted domains
- event log

This is for operator convenience and reproducibility. Treat exported files as local security artifacts because they can reveal browsing-related decision history.

## Effective Privacy Practice

- clear the event log before recording demos if you do not want earlier decisions preserved
- export state only when you actually need to reproduce or share a configuration
- avoid trusting domains casually; trusted-domain state affects credential prompts

## Data Retention

The local event log is bounded by the configured log limit. Old entries are dropped when the limit is exceeded.

## Scope

This document describes the repository's current local behavior. If future work introduces remote services, this document must be updated before release.
