# Recorded overlay campaign (#700)

Continuation of #703; standalone recorder, no extension runtime change.

Run from a clean, committed checkout with the locked dependencies and the matching
Playwright Chromium installed:

```bash
node --test experiments/evidence-observatory/tests/*.test.mjs
node experiments/evidence-observatory/run-campaign.mjs
```

The wrapper compares every raw tracked source file with committed Git blobs,
refuses extra/untracked/linked source inputs, builds the extension, rechecks the
source and binds the exact built artifact. It does not rely on filter-aware
`git status`, accept an external extension path, or claim dependency integrity.
Standard generated output/dependency directories are explicitly excluded. This
bounded campaign check advances #684 but does not close its broader provenance
work or #692's release boundary.

Two variants (stable layer and display-rewrite/reinsertion) each run baseline,
protected, benign and mixed arms, with separate fresh browser profiles and typed
one-use receiver targets. Baseline means extension absent, not Navigation Off.
The browser's own popup blocker is explicitly disabled in both compared arms;
this isolates the extension contribution under that declared topology, rather
than claiming normal browser-default effectiveness.

Each variant repeats with detailed recording enabled and disabled. Both retain
minimal outcome, frame-lifecycle and receiver observation; this is detailed-
instrumentation parity, not proof of zero observer effect. One paired run per
variant is not a statistical performance estimate or a held-out realism campaign.

The health probe uses an actual HTTP HEAD challenge against the same receiver,
through a private test-runner channel unavailable to the fixture. It never spends
the harm target. Receiver callbacks use copies; listener errors are counted while
the accepted consequence remains recorded. End health is checked after browser
shutdown while the receiver is still running, retaining late accepted requests.

Fixture attempts are page-reported layer installation/reinsertion. They are NOT
invented navigation calls after the defense has already hidden the layer. Chrome-
owned worker storage supplies existing cleanup decisions; receipt time in the
collector is the time those records were read, not their original decision time.
Pointer input and control completion are separate browser-runner observations.
The sink independently receipts the declared inert GET consequence.

The v2 trace adds runner-assigned page/frame/document epochs, optional source-local
clock identity, exact receiver binding, before/after health and source metadata,
and optional sampled geometry. No full URLs, query strings, DOM or form/clipboard
values are exported. The original v1 and legacy adapters remain available.

All source labels in an imported JSON file remain forgeable. Structural support
is conditional on the trusted runner and bounded scenario; no automatic registry
promotion, owner Chrome gate or open-web efficacy claim follows.

## Current qualification and remaining scope

The initial local recorder/source suite has 100 passing tests, and the full
repository unit suite has 3,286 passing tests. Local typecheck, lint, release
build and unchanged performance budgets passed. Browser qualification must be
read on the exact PR/workflow head; a committed test is not an executed campaign.

#700 remains open for independent review, repeated observer-effect qualification,
explicit browser fault injection (worker restart, primary-frame loss, receiver
death, stale-build attempts) and integration with other attack families. Existing
unit faults verify conservative assessment but are not browser fault campaigns.
#701 owns richer geometry replay and held-out realism; #702's live recording stays
behind existing consent/privacy and feedback prerequisites.
