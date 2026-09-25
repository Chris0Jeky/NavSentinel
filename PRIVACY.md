# Privacy

NavSentinel is designed to be local-first.

Local handling still counts as user-data handling under current Chrome Web
Store policy. The current development build starts content scripts at
`document_start` before an affirmative activation gate exists. #455/PM-03
blocks beta on two separate boundaries: before installation, the CWS listing
and Privacy Practices must disclose every category/use and dated evidence or
CWS support confirmation must establish affirmative install consent; after
installation and before handling, the extension must remain passive until
in-product disclosure and explicit activation. Revocation/reset must also be
available and tested.

NavSentinel's use of information received through Chrome APIs adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements. Data
is used only to provide or improve the disclosed local security purpose; it is
not transferred for advertising, credit, data-broker, or unrelated purposes.

## What The Extension Stores

`chrome.storage.local` contains more than settings and the visible event log.
The current development build stores:

| Data | Bound / retention | Export and deletion |
|---|---|---|
| Suite settings | Until changed or extension removal | Export/import; settings can be changed in Options |
| Navigation allowlist and trusted credential domains | Until user removal or extension removal | Export/import; each has Options controls |
| Event log | User-configured 50–5,000 entries (default 300), oldest evicted | Export/import; **Clear log**; **Clear behavioural data** |
| Prompt outcomes | Latest 500 entries | Export/import; **Clear stats**; **Clear behavioural data** |
| Adaptive per-domain scores | Up to 200 domains | Exported; ignored on import and recomputed from imported prompt outcomes; **Clear stats**; **Clear behavioural data** |
| Domain behavior profiles | Up to 500 domains; per-domain NRS history capped at 50; old counts decay | Not in export; **Clear domain profiles**; **Clear behavioural data** |
| Navigation-category profile | Category counts normalized after 10,000 observations; recent burst list capped at 20 and pruned after 24 hours | Not in export; no current user-facing clear control |
| Smart-default cooldown pairs | Up to 200 source/destination pairs; each expires after 24 hours | Not in export; no current user-facing clear control |

**Clear behavioural data** (Options → Analytics) is the single reset control. It
erases the event log, prompt outcomes, adaptive per-domain scores, and domain
behaviour profiles in one service-worker-owned pass, and deliberately KEEPS
suite settings, the navigation allowlist, and trusted credential domains —
erasing configuration you set on purpose would be data loss. Navigation-category
counts and smart-default cooldowns are not in that boundary and still have no
clear control. The recorded #535 / AI-28 waiver accepts this limited reset for
the current merge wave; it does not close RI-06/#474 or claim a full
behavioural-data reset.

The reset records its remaining lanes in `chrome.storage.local` before the first
destructive write, so a service-worker termination or browser restart part-way
through finishes the remaining lanes on the next start rather than leaving
residue. If a lane cannot be cleared, the control says which store still holds
data instead of reporting success; and if every store cleared but that record
could not be retired, the control says the reset was not finalized and may run
again at the next browser start, rather than reporting a success that could
later erase records you create afterwards. One residual remains: domain profiles are
written directly by content scripts (see issue #181), so a profile write already
in flight when the reset runs can survive it; re-running the control clears it.

The event and prompt-outcome records can include timestamps, source/destination
hostnames, outcomes, risk scores, reason codes, bounded structural click
context, and other decision inputs. Prompt outcomes keep hostnames only, with no
URL (#518). The event row's `url` field is reduced to origin and path: its query
and fragment are dropped (#468) and likely-secret path segments are redacted
(#517). This applies to that field in new records, imports and exports, and
existing data is migrated. A remaining path can still show which page you were
on. Mutation-alert `extra.details` can still retain a full form-action or iframe
URL, including its query, in stored and exported rows (#902); this exception is
open for correction in #910.

Detection also transiently processes bounded page text/HTML, title/form/image
signals, structural click/element properties, and clipboard text/selection in
the page's MAIN world to derive command metadata. That raw page/clipboard
content is not stored, exported, or transmitted, but it still belongs in the
#455 pre-collection disclosure and consent boundary.

RI-06 in `docs/Project_Roadmap.md` requires a purpose-specific data policy
before beta: minimize persistent logs/profiles to the least identifying form;
retain exact URLs in `chrome.storage.session` only where target authorization,
rollback, redirect, or OAuth correctness requires them; bind them to a tab and
short TTL; and add one user-facing reset that clears every behavioral store.
The unified reset now exists as **Clear behavioural data**, scoped to the four
stores listed in the table. The recorded #535 / AI-28 waiver accepts that
limited boundary for the current merge wave; RI-06/#474 remains open until the
excluded navigation-category and cooldown stores are resolved without calling
the reset complete.

`chrome.storage.session` holds ephemeral per-tab security state such as allow
windows, gesture tokens, exact rollback/forward/OAuth URLs, redirect chains,
and child-window tracking so behavior survives service-worker restarts. It is
cleared when the browser closes. OAuth callback URLs can contain authorization
codes, access/ID tokens, or other response parameters; RI-06/#455 must redact
those secrets before storage, export, or logging. Exact operational URLs must
not be stripped with a blanket sanitizer because doing so can widen an
allowance or break recovery; RI-06 requires field-by-field purpose and TTL
tests that preserve security-critical host/target binding.

## Build-Time Assets And Profiles

The release-eligible `interaction-only` build bundles the static Public Suffix
List snapshot used for registrable-domain extraction. It does not contain or
load a reputation asset.

The explicit `research-reputation` build can additionally bundle the small
reserved-domain bloom fixture. That profile is for local unpacked experiments,
is marked non-release in its deterministic build receipt, and is rejected by
the package and release paths. It is not production threat intelligence.

These are read-only. They are never updated at runtime and require no network calls.

## What The Extension Does Not Do

- no telemetry upload
- no background sync
- no cloud scoring
- no credential exfiltration
- no remote allowlist or reputation lookups
- no clipboard content bridging, storage, or transmission. ClickFix logic
  transiently inspects clipboard text/selection in the page's MAIN world to
  derive length and a command-like boolean, then sends only that metadata.

## Overlay Cleanup Review And Diagnostic Bundle (#591)

Overlay cleanup outcomes are retained as `mutation_alert` rows in the existing
bounded event log (`sentinelsuite:event_log_v1`, user-configured 50–5,000
entries, default 300). The Protection Center review queue projects only finite
outcomes (suppressed, reasserted, already hidden, budget-limited, restored by
Undo or a setting change, reported miss, observed), journal reason codes,
coarse frame and geometry/stacking buckets, timestamps, and local labels. Page
URLs, hostnames, raw detail strings, scores, and internal IDs are never shown
in the review projection.

Review labels (“Should block” / “Should allow”) and reported misses live in
the same event-log lane as `extra.overlayReviewLabel` and
`extra.overlayCleanupOutcome = "user_reported_miss"`. They clear with **Clear
log** and **Clear behavioural data**; no new store, permission, endpoint,
identifier, upload, or automatic telemetry exists. Labels are local-only, are
not protection outcomes, and never change protection counts or enter the
diagnostic payload.

The diagnostic bundle is explicit and preview-before-download only. Its fields
are limited to product/build version, browser major (0 means unavailable),
top-versus-child frame, finite reason codes, coarse geometry/stacking buckets,
lifecycle timestamps/outcomes, bounded retry counts (0–128), and finite
readiness/error categories. It excludes raw DOM/HTML, element text, form
values, clipboard, cookies/storage contents, request/response bodies,
query/fragment strings, full browsing history, screenshots, blanket page
console/network logs, hostnames, URLs, internal IDs, and arbitrary detail
strings. Every field is sanitized and capped; the preview shows the exact
serialized bytes used by Download, with count and output bytes recorded
(256 KiB limit). Cancel discards the pending preview and returns focus.

To share voluntarily, prepare the bundle in Protection Center → Diagnostics,
review the exact preview, choose Download (or Copy preview), and attach the
file yourself to a GitHub or support report. Public GitHub issues make
attachments public. Any future direct submission or training use remains a
separate owner-approved privacy/security/release change.

## Import And Export

The options page supports local JSON export and import of:

- settings
- allowlist
- trusted domains
- event log
- prompt outcomes
- adaptive per-domain scores (exported for inspection; recomputed on import
  from prompt outcomes rather than trusted as imported state)

Domain behavior profiles, navigation-category profiles, smart-default
cooldowns, and session state are not included in the current export.

This is for operator convenience and reproducibility. Treat exported files as local security artifacts because they can reveal browsing-related decision history.

## Effective Privacy Practice

- clear the event log before recording demos if you do not want earlier decisions preserved
- use **Clear behavioural data** to reset the event log, prompt outcomes,
  adaptive scores, and domain profiles together; the per-store **Clear log**,
  **Clear stats**, and **Clear domain profiles** controls remain for narrower
  resets. Navigation-category and cooldown reset controls are still missing
- export state only when you actually need to reproduce or share a configuration
- avoid trusting domains casually; trusted-domain state affects credential prompts

## Data Retention

Bounds and controls are listed in the table above. Extension removal clears its
local/session storage. The in-product **Clear behavioural data** reset covers the
four behavioural stores named above; the navigation-category profile and
smart-default cooldowns are still outside it. The recorded #535 / AI-28 waiver
accepts the limited boundary for this merge wave, while RI-06/#474 remains open.

## Scope

This document describes the repository's current local behavior. If future work introduces remote services, this document must be updated before release.
