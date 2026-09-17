# Initial Observatory qualification

Date: 2026-09-13. Base source: `476301ad1c4b56fc83ed335ac83e343dc93d675e`.
This record qualifies the additive evidence consumer, not NavSentinel's defenses.

## Local checks actually run

Node 22.16.0, Linux. The optional module uses Node built-ins; the full repository's
lockfile dependencies were not installed for these checks.

```bash
node --test experiments/evidence-observatory/tests/*.test.mjs
node experiments/evidence-observatory/cli.mjs demo --out NEW_DEMO_DIRECTORY
node experiments/evidence-observatory/cli.mjs inspect --input SELECTED_JSON_DIRECTORY --out NEW_REPORT_DIRECTORY
```

The initial candidate passed **79 tests**, zero failures/skips. Coverage includes
four-arm prerequisites, false success from empty/dead/reused sinks, partial-green
campaigns, cross-source run reuse, harm after a block, recovery then further harm,
producer failures/retries, expected-versus-observed results, invalid provenance,
causal/clock validation, byte/count limits, strict UTF-8, hostile HTML strings,
CSP script hash, legacy phase counters, symlink refusal, non-overwriting outputs,
CLI exit semantics, attachment failures and explicit duplicate copies.

During implementation the tests caught malformed select options and an assertion
that failed to decode HTML-escaped CSP attributes. Importing the actual mixed-arm
receipt also caught an adapter assumption that all protected phases had a baseline
counter. These were corrected and regression-tested; no product behavior or test
assertion was weakened. A separate review corrected recovery state after subsequent
harm and required distinct cross-source run IDs and intervention in both protected
and mixed arms.

## Existing hosted artifact integration (not a new campaign)

Downloaded through the authorized GitHub connector:

- Workflow [34724451033](https://github.com/Chris0Jeky/NavSentinel/actions/runs/34724451033).
- Artifact `navsentinel-e2e-evidence`, ID `10307572121`, created 2026-09-12T23:20:58Z.
- ZIP SHA-256 independently checked locally:
  `12f342e2a7ad4ef5531a3ac7c3fee2bcecd4babff426743977e7ca8241146cec`.
- The workflow is associated with #696 head `ce6ff372bd4d5d90daaefad38d6bbd524e072350`.
  Overlay receipts themselves name repository head
  `57f2920c8668db6ae5b7a0b4c55e210289448a2e`; these identities were not rewritten or
  assumed identical. The viewer is not an exact-head provenance verifier.

Selected the original JSON receipt/hidden-media files, excluding duplicate
`attachments/` copies; no raw artifact was committed. Of 34 selected JSON inputs,
**32** were supported (four overlay receipts and 28 hidden-media diagnostics).
The two unrelated issue186/evasion formats were explicitly rejected as unsupported,
so the broad inspection exited 2 while still writing its diagnostic report.

The supported projection contains **16 cases with harm receipts**, including
**10 classified as harm then recovery**, and **zero supported prevention comparisons**.
These counts include unprotected baselines and out-of-model controls: they are NOT
16 product vulnerabilities, 10 failed defenses, or a recall/false-positive metric.
All supported legacy cases remain unverified; missing native producer contracts
prevent promotion. The repaired adapter reports zero structurally invalid supported
cases. The two unknown formats are not silently discarded or translated.

A narrower directory containing only the 32 supported sources can be inspected
successfully; `check` still returns 1 because there is no complete native comparison.
The generated report is useful evidence navigation, not an independently re-executed
security campaign. Artifact retention is finite; source fixture adapters and unit
fixtures remain reproducible without access to this specific hosted download.

## Browser and integration limitations

A local attempt to open the generated file in the environment's managed Chromium
failed with `ERR_BLOCKED_BY_ADMINISTRATOR`. Policies were not altered or bypassed.
No local visual/browser acceptance is claimed. `smoke-browser.mjs` and the scoped
workflow provide viewer-only browser qualification on a normal test runner, with
responsive screenshots, keyboard controls, download-byte equivalence and hostile
text/zero page HTTP request checks. Their final hosted result must be read on the
actual PR; merely committing the workflow is not evidence it passed.

The optional Playwright reporter has callback-contract tests, but was not run as
part of a fresh full extension campaign locally. This PR does not claim full-repo
Vitest/typecheck/build/performance-budget/E2E success. No extension runtime or build
input is modified; standard repository CI and fresh review remain required. The
complete native collector, annotated scene replay and everyday session recorder
remain #700, #701 and #702 respectively.
