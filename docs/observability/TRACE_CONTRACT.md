# Observatory trace v1 and agent contract

Authoritative validator: `experiments/evidence-observatory/model.mjs`.
Executable, explicitly authored example: `demo.mjs`. The initial document describes v1. The #704 producer emits v2 with explicit health,
source, receiver and scene metadata; see the v2 section below. Do not change a
teaching example to `synthetic` and describe it as measured evidence.

## Envelope

`schema` is `navsentinel.observatory.trace.v1`; `mode` is `demo` or `synthetic`.
`campaignId`, `scenarioId`, `variantId` are opaque tokens (ASCII letters/digits plus
period/underscore/hyphen, maximum 96 characters). IDs are not raw URLs or page text.
`identity` contains repositoryHead (40 lowercase hex), extensionSha256 and
fixtureSha256 (64 lowercase hex), browserVersion, profile and seed. Missing/invalid
identity fields produce gaps, not invented values. The fixture digest must bind the
attack implementation and declared settings; arm-specific protection is separate.

`runs` has at most 16 entries. A run contains unique `runId`, `arm` (baseline,
protected, benign, mixed), `protection` (off/on), boolean `completed`, optional
canonical `declaredOutcome`, `observer` and `events`. Unknown fields are rejected.
The native contract does not accept `live` mode; live projection needs a separate
reviewed contract rather than silently broadening test-data acceptance.

## Observer receipt

Required numeric fields are `startedMs`, `endedMs`, `requiredMs` and `droppedEvents`.
Times are finite, nonnegative, at most one day; end follows start and required
window is positive. Required booleans: `sinkHealthyStart`, `sinkHealthyEnd`,
`freshTarget`, `egressFenced`, `extensionReady`, `trustedInput`, `baselineIndependent`.
They are producer attestations, not capabilities conferred by JSON. #700 must
establish them from independent mechanisms and preserve their supporting receipts.

The baseline requires protection off and an independent baseline. Other arms
require protection on and readiness. A fresh live receiver, trusted test input,
egress fence, complete duration and zero losses are required for negative evidence.
The health check must not consume the one-use consequence target. Missing readiness
or a destroyed observer invalidates inference from an empty sink.

## Events

Each event contains `id`, strictly sequential `sequence` beginning at 1, nondecreasing
`elapsedMs` within the observation window, `source`, `kind`, `frame` (top/child/none/
unknown) and `causes` (zero to four distinct earlier event IDs). `code` is an optional
bounded reason token. Future document/frame epochs and origin-safe structural
metadata need explicit schema evolution; do not hide structured data inside `code`.

| Source | Kinds |
| --- | --- |
| runner | run.start, input.dispatched, observation.end, observer.gap |
| page | attack.intent, attack.attempt, dom.changed |
| extension | decision.block, decision.allow, decision.warn, decision.hold, decision.rollback |
| browser | navigation.committed, navigation.restored, request.observed, control.completed |
| sink | sink.receipt |

Only `sink.receipt` accepts `consequence` (harm/benign) and a sequential
`sinkSequence`. Page-source sink events, sink fields on another event kind, missing
causes, duplicate IDs, backwards collector time and unknown kinds are rejected.
Collector order records receipt order, not omniscient cross-process causality. A
source label in a file can be forged; the collector and original artifact must be
trusted before treating the record as an authentic observation.

The first event is run.start at startedMs and the last is observation.end at endedMs.
Attack arms require both dispatched input and recorded attempt. A held/block decision
must appear after an attempt to support the structural comparison; this ordering is
necessary, not sufficient proof of a browser-native causal initiator. Positive harm
remains visible even when observation is incomplete. Recovery after harm never
changes harm count to zero; further harm after recovery clears recovered state.

## Comparison and outcome rules

Compare only the same campaign/scenario/variant and identical artifact identity.
Exactly one baseline/protected/benign/mixed arm and distinct run IDs are required.
Every run must be complete, with no gaps. The baseline reaches harm; all protected
arms reach none; benign and mixed runs each have benign receiver acceptance and
legitimate task completion; protected and mixed have the recorded post-attempt
pre-harm intervention. Demo mode always prevents support.

The result `BOUNDED_PREVENTION_SUPPORTED` means *the supplied producer contract
supports this bounded conclusion*. It does not authenticate JSON, compare raw
executed bytes with Git, prove real credential protection or satisfy release gates.
`supportsCompleteSet` and CLI `check` require the whole input set to meet the
contract; one supported campaign cannot hide another incomplete one.

Other assessments: `HARM_OBSERVED`, `HARM_THEN_RECOVERY`, `BENIGN_COMPLETED`,
`INCONCLUSIVE`, `INVALID`. `declaredOutcome` remains separate. Outcome language in
a legacy test title/expectation is never accepted as an observation. Invalid runs
retain positive consequence facts for diagnosis.

## Report and errors

Output schema is `navsentinel.observatory.report.v1` with
`evidencePolicy: DIAGNOSTIC_ONLY_NO_REGISTRY_PROMOTION`. `sources` records ordinal ID,
SHA-256, byte length and adapter. `cases` contains facts, event sequence, explanations,
gaps, warnings and supplied identity. `comparisons` enumerates prerequisites and
reasons; `rejected` includes bounded error categories; `duplicates` maps byte copies.
Reporter outputs also include aggregate execution/collection counters. Error strings
do not include raw filenames, page errors or untrusted prose.

Agent workflow: locate a variant; read facts before producer claims; inspect gaps;
link events and input digests; distinguish an absent fact from zero; reproduce using
the original approved campaign, never a command copied from page-derived data.
Do not feed user labels into protection without an independently reviewed process.

## Legacy adapters are deliberately conservative

Overlay v1 verifies `local_receipt_sha256` against its existing snapshot+observation
serialization. This is a self-consistency check only. A protected phase can have
zero new receipts while retaining a baseline receipt in its cumulative snapshot.
The mixed arm uses its own fresh snapshot and need not contain a baseline counter.
Neither legacy shape supplies the full new observation-health/freshness contract.

Hidden-media diagnostics use explicit before/after counters and scenario/role-bound
receiver rows. Raw URLs, toast text, page errors and unrelated object fields are
not exported. Page diagnostic clocks and duplicated forwarding remain visible as
unbound capture-order evidence. Missing artifact identity and baseline pairing are
reported as gaps. They cannot be silently converted into native certified runs.

All adapters are test-only minimizers, not a general browsing-data sanitizer. Fields
that accept identifiers can still contain sensitive strings supplied maliciously.
Never import a real browsing dump and assume this projection made it shareable.

## Recorded v2 additions

`capture-v2.mjs` defines `navsentinel.observatory.trace.v2`. V1 and explicit legacy
imports stay supported without silently filling their missing fields. V2 adds a
provenance envelope (raw source tree/input digests, lockfile/settings digest and
after-run artifact digest), run-scoped context/target IDs, full/minimal recording
mode, before/after HTTP health challenge receipts and bounded fault categories.
Receiver events bind run/scenario/role/target and one-use counts. Observation health
cannot be borrowed from a different run. Negative evidence requires the declared
window to finish after the last dispatched input.

Optional event context contains runner-assigned page/frame/document and parent-frame
IDs; source clocks stay distinct from collector receive time. `scene.sample` contains
a bounded viewport and up to 16 typed rectangles, visibility state and target/scope
categories, never full DOM or arbitrary URLs. The renderer shows the latest earlier
measurement and its age; document replacement invalidates stale geometry.

The fixture's attack attempt is installation/reinsertion of an intercepting layer;
a native navigation prevented before input reaches that layer is not invented as
an executed call. Product cleanup records are collected from existing worker-owned
storage with their collection time, not backdated to a fabricated original time.
This is scoped synthetic evidence, not general native initiator attestation.

For executable contracts, faults and commands see `CAMPAIGN_700.md`; for the visual
measurement boundary see `SCENE_INSPECTION_701.md`.

## Deliberate observer faults (v2 additive events)

`fault.injected` (runner) announces a deliberate experiment and always adds
`INTENTIONAL_FAULT_EXPERIMENT`, excluding that run from prevention support.
`worker.stopped` / `worker.restarted` (browser) record CDP-observed stop and a
subsequent new in-memory epoch. They do not mean the worker continuously observed
anything while stopped. `observer.gap` carries the first timestamped occurrence
of a strictly allowlisted fault; identical repeats are coalesced, with the full
category retained at the terminal boundary even if event capacity is exhausted.

`navsentinel.observatory.fault-check.v1` is a separate **test-system** summary,
not a replacement trace or a prevention outcome. Its six fixed trials require
native v2 synthetic records, exact-input attestations, ready preconditions, one
identified injection and its corresponding observed effect. Missing, duplicated,
unknown, stale-source or unconfirmed trials fail qualification. Receiver errors
must be present in receiver-owned health counters; page floods must retain a harm
receipt after injection. Frame/worker transitions require actual browser events.
The same producer-authenticity and dependency-trust limits continue to apply.

## Separate child-form diagnostics

The form adapter accepts `navsentinel.observatory.form.v1`, not an alternative way
to mint native v2 proof. It retains strict enum-only intent snapshots, independent
accepted/rejected receiver attempts and health observations. The report adds
`cases[].formEvidence` and `formComparisons`; it leaves `proof` null and native
`supportsCompleteSet` false for form-only inputs. See `FORM_TRACE_INSPECTION.md`.
