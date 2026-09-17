# Observatory recorder and scene replay implementation plan

Date: 2026-09-13. Parent: #703 at `361712f454a20e9b651866990a4e46143d1869c4`.
The owner approved continuing #700/#701/#702. Implementation is optional test tooling;
no product runtime collection, detector policy, permission or release waiver changes.

## Design

Use the existing typed receiver and nested-overlay fixture, not a parallel attack
framework. Add independent receiver health/freshness checks, a bounded runner-side
recorder, exact operation/decision/consequence lanes and an opt-in four-arm campaign.
Extend the trace format explicitly for source identity, frame/document epochs,
source-local clocks, scene samples and terminal gaps. Keep v1 imports readable.

Scene playback renders measured rectangles and frame relationships at a selected
event, never executes captured HTML. It must label missing observations and page
reports, and must not interpolate an imagined continuous browser recording.

Everyday-browsing collection remains default-off/unimplemented until #455/#591;
prepare a read-only projection of the existing minimized export only if its current
contract can be reused without new collection or a second feedback store.

## Execution checklist

- [x] Reconcile main, #703 and #700; restore exact source/locked tooling in a fresh
  workspace. Baseline Observatory suite: 79/79.
- [ ] Receiver tests first: health challenges never spend an authority; accepted
  receipts, invalid attempts, callback loss and server closure are independent.
- [ ] Implement health/observer methods on `proving_ground_fake_sink.ts`, preserving
  old snapshot/URL behavior. Run focused Vitest, typecheck, lint.
- [ ] Recorder tests first: monotonic order, terminal on failure, capped page input,
  dropped count, retained harm, non-writable snapshots, run/context/target reuse,
  mismatch and source-artifact changes. Implement `capture-v2.mjs`/`recorder.mjs`.
- [ ] Add opted-in fixture phase reports and a dedicated fresh-context baseline,
  protected, benign, mixed browser campaign. Baseline is extension-absent, not Off.
  Reuse existing egress fence and receiver; add positive benign receiver action.
- [ ] Add observer-on/off and bounded timing variants. Emit traces in finally and
  preserve any survivor, missing sensor or unsupported profile as non-success.
- [ ] Qualify actual campaign on a normal hosted Chromium runner; do not change
  managed local browser policies or treat missing tooling as a passing campaign.
- [ ] Add strict scene samples and a frame/target view to the offline inspector;
  test hostile input, keyboard operation, report parity and responsive layouts.
- [ ] Reconcile #702 prerequisites and record delivered versus remaining scope.
- [ ] Run the source tests, relevant full checks, inspect generated views, publish
  PR(s) and exact-head test receipts, and leave broad issues open for unmet criteria.

## Acceptance boundary

Zero harm receipts only supports a bounded conclusion when the independent attack
baseline succeeds, exact target authorities remain healthy/fresh, the full window
is observed, the expected product action is recorded, and benign tasks complete.
The local producer is trusted test machinery, not an authentication service. Code
and fixture input digests identify source; raw committed-input checks do not prove
dependency integrity or arbitrary-source reproducible builds. #684 remains the
cross-campaign provenance owner. Native actor/bridge identity and open-web efficacy
are not solved by these additions.
