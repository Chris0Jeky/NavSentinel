# Windows serial blank-anchor stress — 2026-10-02

Source: `ae13cc02ea387b3ec6ec9e24a08728defd3dcce7` (clean source checkout).
Artifact-bound repeat: `75c66283ab56e075a240722c484a6925b998c4e6`, whose only
change from that source is this initial 69-line receipt.
Related: [#460](https://github.com/Chris0Jeky/NavSentinel/issues/460).

## Observed supported topology

The five original stress scenarios each passed five times in both Windows campaigns:

| Scenario | Initial passed / attempted | Artifact-bound repeat |
| --- | --- | --- |
| Evasion 02: medium-size overlay | 5 / 5 | 5 / 5 |
| Level 3 instant injection | 5 / 5 | 5 / 5 |
| RW-14 checkout express-pay | 5 / 5 | 5 / 5 |
| RW-17 media overlay hijack | 5 / 5 | 5 / 5 |
| RW-18 fake codec warning | 5 / 5 | 5 / 5 |

Each terminal JSON reports **25 expected, 0 unexpected, 0 skipped,
0 flaky, errors empty**; each captured CLI exit is **0**. Test durations are
70.64 seconds initially and 69.18 seconds for the artifact-bound repeat.
The regression project resolved `repeatEach: 5`, `retries: 0`; overall config
resolved `workers: 1`, `fullyParallel: false`. Neither `CI` nor
`NAVSENTINEL_E2E_WORKERS` was set, and no worker override was passed.
The repeat explicitly set and recorded `EXTENSION_PATH` to the hashed owned
`extension/dist` directory; the first run did not record that optional override.

The exact selector names the original medium-size Evasion case. The old issue's
broad `Evasion 02` expression now also selects three newer cleanup/settings
cases, so it would no longer describe a five-case campaign.

```powershell
$env:EXTENSION_PATH = (Resolve-Path -LiteralPath extension/dist).Path
node node_modules/@playwright/test/cli.js test tests/e2e/evasion.spec.ts tests/e2e/navsentinel.spec.ts --project=regression --grep 'Evasion 02: medium-size overlay is blocked|Level 3 instant|RW-14 checkout|RW-17 media overlay|RW-18 fake codec warning' --repeat-each=5 --reporter=json
```

## Artifact and browser identity

- Build profile: `interaction-only`, release eligible, reputation and
  JS-behavior instrumentation disabled; standard build/worker/content checks passed.
- Browser: bundled Playwright Chromium **143.0.7499.4**, Playwright **1.57.0**.
  The specs launch headed persistent contexts with disposable profiles.
- Browser executable SHA256:
  `98da1bd10d317fd533c357dfcb374bb9c8c23d28c11c0a04bbd550d2add95e2d`.
- All **46** built files were copied and source/copy SHA256 compared before each
  run. Every original built file remained unchanged after each run, and both
  campaigns' artifact file/hash manifests are identical.
- Sorted artifact manifest SHA256:
  `be0b17f25e26171725636c10fdc85ae2fb6ead083aff62cd2e0d5e0b62a4754f`.
  Its input is UTF-8 lines `relative/path sha256`, sorted by ordinal path, with a final newline.
- Local ignored receipts: `artifacts/issue460/serial-collected/receipt.json`,
  `report.json`, `stderr.log`, `artifact-manifest.txt` and `exact-artifact/`. These include all per-file hashes
  and the captured child exit; no generated browser output is committed.
- The artifact-bound repeat has corresponding receipts under
  `artifacts/issue460/serial-bound-artifact/`, including the explicit child
  environment's `EXTENSION_PATH` and the same artifact manifest digest.

The original source tree is byte-identical to reviewed PR
[#1010](https://github.com/Chris0Jeky/NavSentinel/pull/1010)'s head
`d25fc209652a39c338e4d87148883064c5086a05`; both Git tree IDs are
`219b909df746270659ab3901b59f0082bad47b69`.
Its [full hosted E2E run](https://github.com/Chris0Jeky/NavSentinel/actions/runs/37064980271)
passed. Both new local campaigns ran the five selected scenarios only.

## Limits and remaining issue

This result establishes the observed current serial lane. It does not determine
the cause of the historical parallel failures, prove that serial execution can
never fail, or close #460. The earlier handoff records serial 25-case popup
failures too; the focus/user-activation explanation remains a hypothesis.

No parallel campaign, product interception fix, retry/timeout change or weakened
assertion is included. No branded current/minimum compatibility matrix or human
Gate-3 pass is claimed. `ACTION_ITEMS.md`/AI-19 remains the human queue.

An initial selector used start anchors against Playwright's full test title,
collected no tests and exited 1. That setup attempt is excluded from the 25-case
result; collection was checked before the corrected campaign.
