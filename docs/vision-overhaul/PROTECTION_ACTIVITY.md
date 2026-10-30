# Protection Center activity (#592)

The Protection Center reads the existing bounded event journal. Its categories
describe recorded actions, never verified attacks prevented or a safety score.
The existing Options link opens the view; every category opens the filtered
journal, where each row expands into readable reasons and explicit export preview.

## Counting contract

One existing non-empty event ID contributes at most once. When an imported
snapshot repeats an ID, the last valid retained row wins, matching the journal's
replacement semantics. Each admitted row has exactly one category, or remains
an uncategorized observation. No new correlation ID is minted.

| Category | Recorded source | Important exclusions |
| --- | --- | --- |
| Overlay interventions | The #562 exact-boolean `overlayAutoDismissed` contract: detected or injected overlay, or cleanup accompanying a held click | Reassertions/already-hidden follow-ups are not new interceptions; ambiguous reasons do not count |
| Clicks blocked | `nav_click_block` without qualifying overlay cleanup | Overlay cleanup takes priority, so the same record does not count twice |
| Redirect / popup interventions | `nav_blank_prompt` or `nav_rollback` without qualifying overlay cleanup | A held or rolled-back navigation is not independent proof that a harmful consequence was prevented |
| Warnings only | `cred_paste_warn`, `clickfix_detected`, `nav_reputation_late_warn`, or a recorded high-severity overlay warning / cleanup-budget warning | Detection-only double-click and pushState observations, credential evaluations/prompts, ordinary mutation observations |
| Choices & corrections | Undo / settings restoration records, navigation allowlist edits, credential allow-once and trust edits | These are user choices, not wins and not automatic proof that an earlier decision was wrong |

Undo context uses the existing `restored` boolean. `true` means restoration was
reported successful; `false` means restoration was not confirmed; missing legacy
metadata stays unknown. The view never repeats an unconditional “restored” reason
for a failed or unconfirmed Undo. Recovery points to existing Protection settings;
the journal does not replay clicks, navigate to stored destinations or restore DOM.

Different IDs cannot be proven to refer to one physical intervention. Counts are
deduplicated action records, not unique attacks, pages, elements or consequences.
Known cleanup reassertions stay reviewable outside the headline totals. Corrections
cannot reliably be linked back to an earlier intervention and are not subtracted
from it or presented as a success rate.

## Time, retention and privacy

Today uses this device's local calendar and supported stored timestamps up to the
snapshot time. A future timestamp remains visible for review but cannot contribute
to activity totals. Invalid dates are excluded. Today is unavailable when no
supported timestamps remain. The oldest/latest supported timestamp describes the
snapshot, not continuous coverage since that date or installation.

The configured local record cap and actual timestamp span are shown. Imports may
change that span; no import provenance is invented. Legacy or malformed records
that storage rejects cannot be reconstructed by this view. Clearing the existing
event/behavioural data clears the derived counts and the first-activity milestone.
The milestone has no saved state, target, streak or incentive to browse more.

The existing Options backup remains the source-record round trip. Evidence export
remains the existing `navsentinel-evidence` schema 1, with its explicit preview and
minimized fields; it is not a backup of cleanup metadata or a new diagnostic bundle.
Category and recovery context are display-only and are not added to that format.

While a journal row is expanded or contains keyboard focus, background updates
keep its retained page, row and reading position. Counts and export still use all
current matching records; **Show latest**, filters and page controls deliberately
leave that reading view. Replacement (even with a reused ID), eviction and clear
remove old details and announce the disappearance; removed focus returns to the
journal. An already-open export preview remains the exact snapshot prepared for
review. Reading state is local to the page and never stored or exported.

#591 remains open for local Should block / Should allow labels, richer lifecycle
diagnostics and its redacted bundle. This feature uses the existing safe journal
and preview; it does not claim that broader dependency complete.

## Browser proof and owner check

Use fictional records for populated, duplicate, corrupt/legacy, future-time and
correction states. Check every category drill-down, keyboard focus, Today, clear
and existing backup import, all three themes at normal/narrow widths, and reduced
motion. Exported JSON must keep the existing fields and exclude raw IDs, extra,
full URLs and new category metadata. The shield settles once; reduced motion
shows the same final state without animation.

For #1162, expand and focus an older row while fictional records arrive across a
25-row boundary. Check expansion, focus and scroll position at normal and narrow
widths, then Show latest, filters and page navigation. Replace the same record ID,
evict it and clear history: stale details must disappear and focus must return to
the journal. Reimporting cleared records must not restore their old expansion.
Check that an open export preview stays frozen while the journal updates.

Automated branded-Chrome receipts are not owner Gate-3. The owner-only check uses
the merged build and verifies the same journey and screen-reader/physical input
experience. No agent controls `chrome://extensions` or reloads the owner's copy.
