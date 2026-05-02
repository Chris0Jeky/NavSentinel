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

In `chrome.storage.session`, the extension stores ephemeral tab state (allow windows, gesture tokens, rollback state, child-window tracking) so it survives service worker restarts within a browser session. This data is automatically cleared when the browser closes and never persists to disk.

In `chrome.storage.local`, the extension also stores prompt outcome data including source and destination domains for smart-default suggestions (allowlist after 3 consecutive allows) and cooldown timestamps.

## Build-Time Bundled Assets

The extension ships with two static data assets compiled at build time:

- a Public Suffix List (PSL) snapshot for accurate registrable-domain extraction
- a bloom filter of known-bad domains compiled from public threat feeds (URLhaus, OpenPhish)

These are read-only. They are never updated at runtime and require no network calls.

## What The Extension Does Not Do

- no telemetry upload
- no background sync
- no cloud scoring
- no credential exfiltration
- no remote allowlist or reputation lookups
- no clipboard content storage (ClickFix detection only checks metadata, never stores content)

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
