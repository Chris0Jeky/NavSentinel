# Child-form diagnostic producer

Test-only continuation of #700/#701. This PR is based on #698, not the Observatory
runtime stack. Its versioned JSON is consumed by a separate additive Observatory
adapter on #706. No extension runtime, new permission, user-data store or public
endpoint is introduced. #698's budget/review/owner gates remain in force.

## Execute

From a complete checkout with the locked dependencies and Chromium installed:

```bash
npm run build
NAVSENTINEL_FORM_OBSERVATORY=1 npx playwright test tests/e2e/issue688-form-intent.spec.ts --project=regression --workers=2 --fully-parallel --retries=0 --output=test-results/form-full
npx playwright test tests/e2e/issue688-form-intent.spec.ts --project=regression --workers=2 --fully-parallel --retries=0 --output=test-results/form-control
node experiments/form-observatory/compare.mjs test-results/form-full test-results/form-control
```

On Windows, set the environment variable explicitly in PowerShell for the first
command, then remove it before the control run. Default operation has no detailed
page probe. Both invocations preserve the existing thirty tests and all of their
consequence assertions. Together they execute 90 fresh profiles, with 45 detailed
form traces and 45 corresponding controls. A missing result, duplicate arm or
changed accepted/rejected request vector fails the parity checker. Matching two
samples is not a statistical proof of zero observer effect.

The read-only scoped workflow runs these commands and retains exact-source archive,
source identity, explicit result files, full traces and parity summary for seven
days. The independent certifier strictly parses every top-level and event field,
source-to-kind contract, event ID, sequence and receive time, source/build identity,
pair/run identity, browser version, terminal ordering, receiver-health boundary and
fixed per-arm report prefix. Unknown fields or malformed evidence fail certification.
The normal repository CI still runs its unchanged performance budgets. The scoped
browser check is not a release check and cannot waive an inherited budget failure.
Download evidence before retention expires.

## Recorded boundaries

`navsentinel.observatory.form.v1` has a fixed scenario, enumerated variant,
pair/run identities, supplied source/build hashes, browser version, completion,
dropped count, fixed gap codes, 2,300-ms requested post-input observation and
bounded events. The collector assigns sequence IDs and monotonic receive times.
The first boundary is zero. Separate streams are:

- Authored fixture intent snapshots: input, operation, submit-event, late mutation
  and prepared state. These are **untrusted best-effort page reports**. They are
  neither native initiator identity nor authenticated document/causal ordering.
- Browser committed navigation categories: top/child and fixture/harm/benign/other.
  Raw destinations and authorities do not cross this projection.
- Product-owned local decision-log samples. Their timestamp is sampling time,
  not the original intervention time. Only known navigation-block/rollback kinds
  are projected; unsupported/silent decisions are not guessed.
- Independent receiver attempts: role, observed HTTP method, accepted/rejected
  and ordinal. Rejected second spends cannot disappear behind receiver one-use
  enforcement. Request bodies are drained without being parsed or retained.
- Private HTTP health challenges before browser launch and after browser close,
  while the receiver is still available. The health route is not a consequence
  authority and is never embedded into the fixture or trace.

The page sampler uses authored operation sites, not prototype monkey patches.
It preserves original delay values and does not await page-to-runner telemetry.
The page receives only the primary best-effort reporting binding and cannot choose
runner gap codes. A missing binding or rejected delivery is detected independently:
the recorder and certifier require the fixed prepared/input/operation/submit-event/
late-mutation prefix for that exact campaign arm. Only fixed form/submitter IDs and
effective action/method/encoding/target categories are recorded. No password/input/
clipboard value, DOM text, request body, full URL, query, token, screenshot or
arbitrary error prose is exported in the form trace. Legacy result attachments
remain synthetic-lab diagnostics, not a live-data export.

## Failure handling

Ordinary page records cannot fill the capacity reserved for consequential/terminal
records. Overflow and malformed probes are explicit; positive accepted consequences
remain visible. Receiver observers receive copies and cannot mutate the underlying
receipt. One failed observer does not prevent another observer from receiving it.
Any gap, dropped record, missing browser version, unhealthy or missing receiver
boundary, or missing required per-arm page-report stage forces `completed: false`.
The certifier independently repeats these checks and rejects contradictory or
malformed completion claims. Each started recorder writes a terminal attachment in
`finally`; launch/operation failure or incomplete cleanup remains failed. Cleanup
attempts all owned resources, retains the original operation exception and never
silently replaces it with a later cleanup exception. Missing preflight build/identity
cannot produce a valid trace and fails before starting the recorder.

## Interpretation limits

This matrix contains paired attack runs and protected-only benign controls, not a
matched four-arm campaign for each variant. Its evidence policy is
`FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION`. A receiver accepting harm and later
returning to the fixture is harm followed by recovery. A healthy empty receiver in
a valid pair is observed non-reachability, not the Observatory native prevention
certificate. Receiver rejection is not a NavSentinel block.

Supplied Git/build hashes and the workflow source archive support correlation.
The producer does not embed #684's full raw-input verifier, attest dependency
integrity or authenticate imported JSON. Page intent reports remain forgeable and
are not native causality; transport loss prevents certification rather than being
silently presented as complete evidence. This does not certify open-web efficacy,
request contents, branded Chrome or OS protection. #702's consented browsing
recorder is not activated or implemented.

## Primary references

HTML Living Standard: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
and https://html.spec.whatwg.org/multipage/forms.html (reviewed 2026-09-13).
Submitter attributes and submit()/requestSubmit() have different semantics. The
independent sampler deliberately does not import the defense's intent resolver.
The actual browser consequence remains the oracle, not agreement between two
copies of one resolver.
