# Vision overhaul validation

Measured locally on Windows, 2026-09-08. Node 24.19.0; pinned Playwright Chromium
143.0.7499.4 (build 1200); native Electron 44.2.0. The PR head is the source
identity; local delivery `BUILD-RECEIPT.json` identifies its exact Git head and
extension package hash. This is a development candidate, not a release verdict.

## Changed

- All 62 original files inventoried with hashes; original RESOURCES input intact.
- Maintained Lab source adopted under `experiments/vision-lab` with provenance.
- Real extension Protection Center, existing-store projection, filters, details,
  pagination, local settings summary and minimized JSON export.
- Forest, Paper and Midnight styles across Center and Browser/Desktop/Relay.
- Explicit evidence import, selected-record source/destination view, separate user
  assessments, exact preview/download snapshot, separately scoped history clear.
- Cooperative broker fixed local counter adapter, exact single-use binding,
  client-only credential bootstrap and server-generated receipt identities.
- Locked native shell, constrained IPC and actual native lifecycle verification.
- Reproducible standalone builds, browser/native/data-path scripts and Lab CI.

## Verified

| Check | Result | What it proves |
| --- | --- | --- |
| Original extension baseline `npm test -- --maxWorkers=2` | 3,179 passed / 109 files | Pre-change baseline in isolated checkout |
| Final extension `npm test -- --maxWorkers=2` | **3,202 passed / 111 files** | Existing unit suite plus projection and accessible markup checks |
| `npm run typecheck`, `npm run lint` | Passed | Type and lint checks, including new renderer spec |
| `npm run build` | Passed | Interaction-only artifact, static MV3 worker imports and content-loader identity |
| `npm run check:perf-budget` | **12/12 passed** | 474.1 KiB / 500 KiB total; popup remains within 10 KiB budget |
| `npm run security:check` | Passed | 168 scenarios, 31 capabilities, 65 mappings, 1,512 work units and deterministic views remain valid |
| `npm run package:ext` | Passed | Current interaction-only extension ZIP generated |
| `npm run vision:test` | **116/116 passed** | Synthetic contracts, API roles, capabilities, persistence, observed effects, strict import, native bridge and LF/CRLF build identity |
| `npm run vision:build` | Passed | Three standalone HTML artifacts rebuilt with script CSP hashes |
| `npm run vision:test:browser` | **15 checkpoints passed** | Every served view, all themes, 390px layouts, native storage, actual file entrypoints/CSP, import/correction/download/clear, real API fetch and independent effect/replay observation |
| `npm run vision:test:extension` | **4 checkpoints passed** | Disposable installed test extension reads real Chrome storage and downloads minimized evidence; themes, persistence and narrow layout |
| `npm run vision:test:desktop` | **7 checkpoints passed** | Actual native launch, sandbox/isolation, main-process authenticated IPC, fixed effect once, replay refusal and server/credential cleanup on exit |
| `playwright test tests/e2e/evidence-renderer.spec.ts --project=smoke` | 1/1 passed | Built renderer, stubbed Chrome storage, filters, minimized download, three styles and mobile layout |
| `playwright test tests/e2e/suite-ui.spec.ts --project=smoke` | 1/1 passed | Existing Options normalization and protection-setting persistence in test Chromium |

The integrated browser run consumed the **actual downloaded extension evidence
file**, then retained a separate assessment and downloaded the exact previewed
review report. Its extension events were seeded test records, including private
canaries in URL, arbitrary metadata and caller ID fields. This proves data-path
and minimization behavior; it does not prove detector efficacy.

Screenshots and JSON receipts are generated under `artifacts/vision-lab`. Session
stores and browser profiles live separately under ignored `.local/test-runs` and
are excluded from delivery/CI evidence. Visual inspection covered the three
styles and representative desktop/relay/Center layouts.

## NOT verified

- Owner-installed branded Chrome acceptance: **AI-42 remains open**. The exact
  unpacked reload is human-owned. Automated Chromium does not close it.
- Real runtime of the supplied experimental MV3 guard. Its admitted
  programmatic-submit and other sensor limitations remain documented.
- New detector efficacy, benign-corpus measurement, browser comparison, or OS
  protection. Existing detector behavior is preserved by scope.
- Signed native installers, updates/rollback, Windows ACL isolation, same-user
  hostile-process containment, kernel/DNS/clipboard/process adapters.
- The full local Playwright detector matrix was not rerun for this UI/import
  change. Hosted Build/Unit, E2E and Vision Lab results are read from the PR.

## Failures and workarounds

- Playwright's pinned Windows downloads initially returned ECONNRESET and a
  mirror HTTP 400. The installer recovered through its alternate CDN. Final
  browser checks use pinned build 1200, not a substituted cached version.
- The first native launch was attempted before its binary finished installing.
  After installation, a test assertion was corrected to read `journal.entries`.
  Hidden Windows native windows do not reliably produce compositor screenshots;
  native behavior is asserted directly, and the identical served UI is captured
  by the browser lane. No native screenshot pass is claimed.
- Real browser testing exposed expected HTTP diagnostics: missing optional
  favicon (404) and deliberate replay rejection (409). They are classified by
  exact URL/status in the receipt; other console errors and uncaught exceptions
  fail the test.
- Preview/download timestamps initially differed. The renderer now retains the
  preview snapshot. Generated builds normalize line endings to avoid Windows/CI
  hash drift. Both paths have direct proving checks.

## Residual risk and next work

The imported file's shape is validated; its claimed origin is not authenticated.
Repeated imports append distinct observations and are disclosed in the preview.
Hostnames and timestamps remain sensitive metadata. Storage-quota failures are
reported as session-only retention; export remains available. Local hash-chain
consistency is not an independent signature.

One asynchronous Sol runtime review found no blocking defects. Its proof-gap
finding led to the native request/consume/independent-counter check, which passes.
The highest-value next step is owner feedback on AI-42 and the three styles,
then evidence-driven refinement of the workspace and the already-held #601
decision-authority branch. The supplied experimental guard and native horizon
must not silently replace current protections.

Human-action authority: [ACTION_ITEMS.md](../../ACTION_ITEMS.md).
