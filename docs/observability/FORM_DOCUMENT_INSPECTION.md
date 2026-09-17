# Inspect document-bound form reports

This slice extends #708's offline reader and consumes #709's test-only producer.
The branches have different bases; do not apply their patches sequentially or pull
unmerged runtime #698 into the reader simply to display its evidence.

## The problem

A frame can reload the same URL, or a sibling can contain identical form IDs.
Comparing the nearest input in a tab with the latest reported operation can invent
an intent change that never belonged to the same document. Conversely, carrying a
snapshot through a document replacement can make stale state look current.

## What v2 establishes

The external test runner receives CDP execution-context and frame metadata and
assigns run-local frame/document tokens. Every projected page snapshot carries a
validated reporting binding, bounded by `document.started` / `document.ended`.
The reader rejects unknown bindings, wrong frame/scope, reused document IDs,
concurrent default documents in one frame, page-forged lifecycle events, unsafe
metadata and bindings attached to independent sink events. Missing end records or
missing page observations create explicit gaps; positive receiver facts survive a
missing terminal document boundary.

The optional fixed `experiment` enum separates form-campaign records from six
observer lifecycle exercises. The initial v2 producer omitted this label and is
read as form-campaign for compatibility. Unknown labels are refused. Lifecycle
exercises retain incomplete receiver/input windows: they did not execute an attack
campaign and cannot supply its negative evidence. They are omitted from efficacy
pairing, not relabelled as safe runs.

**Reporting realm is not native causality.** Same-origin code can borrow another
frame's reporting function. Browser metadata identifies the function's realm, not
necessarily the initiating script or the user's intended form. The lifecycle
campaign contains an executed borrowed-function case and the UI states this limit.
No native causal edge, authorization or prevention certificate is minted here.

## Owner workflow

Select a case and open its input / operation snapshot. The form panel displays
reporting documents observed up to the scrubber position, their frame tokens, and
start/end links. It does not reveal future retirement states. Input and operation
must belong to the same active reporting document to be shown as a comparison.
Without a matching input, the earlier column reads “Not recorded” rather than
borrowing a sibling's interaction or comparing the operation against itself.

A same-frame reload creates a new document. A fragment-only navigation retains its
realm. Selecting a retired document clears the current form display, while the
historical event is still accessible by stepping back. A navigation without a
binding cannot invalidate an arbitrary sibling; explicit lifecycle events govern
v2. Legacy v1 keeps its conservative navigation boundary and is visibly unbound.
Receiver receipts remain independent: this does not attribute a network request to
a document merely because its timestamp was nearby.

## Agent workflow

Run `cli.mjs inspect --input SELECTED_JSON_DIRECTORY --out NEW_REPORT_DIRECTORY`.
Read `formEvidence.bindingPolicy`, `experiment`, `documents`, snapshot `binding`,
`gaps` and the source digest. `selectFormIntent` returns one of
`same-reporting-document`, `no-reported-input`, or `legacy-unbound`. These are
association labels, not authenticated causal assertions. `cases[].proof` remains
null for form diagnostics; `check` intentionally does not certify these imports.

Run `node --test experiments/evidence-observatory/tests/*.test.mjs` for the contracts.
With existing locked Playwright tooling, `node experiments/evidence-observatory/smoke-documents.mjs`
qualifies the viewer using pinned actual v2 records. This runs no new product
campaign. The producer's own workflow exercises lifecycle attribution and the
original thirty-case form matrix, then requires all45 recording-on/off arm results
to agree, without retries.

## Limits and next work

Only the exercised page-scoped CDP default worlds at the exact synthetic origin
are covered. Separate child targets, process swaps, BFCache and multiple browsers
need independent lifecycle tests; do not infer them from this pass. Payload truth,
native initiator identity, exact executed-byte attestation and complete four-arm
form comparisons remain separate. #702 still needs the consented, bounded passive
session implementation; this recorder must never be applied to browsing history
as though synthetic allowlists were a general anonymizer.

Primary protocol references (reviewed 2026-09-14):
https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
https://chromedevtools.github.io/devtools-protocol/tot/Page/

`removeBinding` stops transport notifications but does not remove the callable
page function. The test requires collection to stop, not page-global deletion.
