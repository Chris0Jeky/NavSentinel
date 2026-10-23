# Issue #1139: visible credential and toast approvals

Branch: `fix/1139-prompt-visible-clicks`. Base HEAD:
`ff7f684b1ba3fc7524665e2226e422c635b38799`. Results below cover the
uncommitted worktree changes, not that base commit alone.

## Per-item status

- MEDIUM credential approval: implemented. The host and button must be rendered,
  the supported popover must be open, and document/shadow hit tests must reach
  the button at the click coordinates. Focused keyboard clicks use its center.
  Visibility is sampled every animation frame, on observed mutations, and at
  activation. Mutations alone do not reset arming: observed concealment or lost
  hit-testability does. A change of more than 1 CSS pixel in a button's x, y,
  width, or height from its arming box restarts that button's exposure window;
  smaller jitter is tolerated, but cumulative movement uses the original box.
  Rendering gaps and refused clicks still reset arming. The 800 ms delay reuses
  the DoubleClickjacking detector's correlation window through a shared constant.
  Refusal leaves the decision pending; explicit Cancel/Escape/backdrop semantics
  remain available. A refused action also attempts to restore a displaced host
  or closed popover.
- LOW content analyzer: implemented using native Element attribute methods and
  the native tagName getter. This base has no `dom_access.ts` helpers.
- Toast approval/Undo: implemented through the same gate, with disposal when
  the card leaves. Dismiss and passive expiry keep their prior semantics.
- Gate-3: **NOT RUN**. Automated Chromium results are not a human Chrome result.

## Red / green evidence

All commands used `CI=1` (PowerShell: `$env:CI='1'`). No dependency installation
was performed; `node_modules` remains a junction.

Before production edits:

```text
npx --no-install vitest run tests/credential-modal-visibility.test.ts tests/content-analyzer-snapshot.test.ts
2 files failed; 10 failed, 49 passed (59 total).
```

The nine UI regressions approved hidden/covered/unarmed controls. The form
regression threw `TypeError: el.tagName.toUpperCase is not a function`.
The fixture models named-property clobbering explicitly because happy-dom does
not reproduce native form clobbering; its style implementation also needs a
fixture shim when getAttribute is shadowed.

Initial required proving results (historical candidate):

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0; 0 errors, 10 existing warnings in unchanged observatory tests |
| Focused Vitest command below | Exit 0; 8 files, 299 tests passed |
| `npm run build` | Exit 0; interaction-only release profile; loader/worker checks passed |
| `npm run check:perf-budget` | Exit 0; all 12 budgets passed |
| Playwright command below | Exit 0; 8 passed, no retries (36.4 s) |
| `git diff --check` | Exit 0 |

```text
npx --no-install vitest run tests/credential-modal.test.ts tests/credential-modal-trust.test.ts tests/credential-modal-visibility.test.ts tests/ui-toast.test.ts tests/ui-toast-coalesce.test.ts tests/content-analyzer.test.ts tests/content-analyzer-snapshot.test.ts tests/content-analyzer.property.test.ts

npx --no-install playwright test tests/e2e/credential-modal-visibility.spec.ts tests/e2e/credential-document-open.spec.ts
```

The new unit cases cover opacity, visibility, display, filters, clipping,
occlusion, closed top layer, button concealment, arming/reset, coordinate bounds,
focused keyboard activation, missing checkVisibility support, and toast Undo.
The three new E2E variants use local intercepted fixture hosts and dummy
credentials: a trusted click at an opacity-zero Proceed position sends no POST,
the prompt remains pending, immediate visibility restoration is still unarmed,
and pointer/Enter/Space activation after re-arming sends exactly one POST.
The five existing document.open regressions also pass.

An additional `npm test` run was stopped after discovering Git-writing fixture
tests, outside the requested no-Git-write test scope. It had reported one
`state-authority-launcher-contract.test.ts` failure. That run is incomplete;
the failure is unclassified, not claimed pre-existing or fixed here. Do not
interpret this receipt as a passing full-suite result.

## Initial budget bytes (historical candidate)

| Asset | Bytes | Limit |
| --- | ---: | ---: |
| credential_guard entry | 30,937 | 32,256 |
| main_guard entry | 21,478 | 21,504 |
| ui_toast shared chunk | 8,012 | 8,192 |
| ui_action_visibility shared chunk | 2,083 | Covered by total-dist limit |
| Total dist including normalized packaged LICENSE | 540,552 | 552,960 |

The shared visibility gate has its own static chunk, following existing Vite
split groups. No budget threshold or budget-check script changed.
Built UI guard marker: `c9bd6b869696`; artifact: `extension/dist`.

## Remaining boundary

Human Gate-3 remains open in `ACTION_ITEMS.md`: check visible Proceed/Trust,
Cancel, Enter/Space, and concealed-prompt refusal on the intended unpacked
Chrome artifact. No extension reload, human acceptance, remote CI, commit,
push, or publication is claimed. Hostile page CSS can still deny UI availability;
the gate deliberately refuses filters, masks, and clipping conservatively.

Review findings: no independent review was requested or performed in this local
implementation task. A PR review remains outside this no-network scope.

Intended commit message: `fix: require visible armed credential and toast approvals`.

## Driver note (2026-10-23)

The draft also moved `DBLCLICK_WINDOW_MS` out of `main_guard.ts`; that edit was reverted so this PR leaves the MAIN-world bundle untouched (main_guard keeps its own 800 ms constant; `shared/doubleclick_timing.ts` mirrors it for the isolated UI). Re-verified after the revert: build, content-loader, mv3-worker, perf budgets (main_guard unchanged, credential_guard 30.2 KB/31.5 KB, ui_toast 7.8 KB/8 KB), typecheck, 178 focused unit tests, and `CI=1` e2e (credential-modal-visibility + credential-document-open) 8 passed.

## Independent review fixes (2026-10-24)

Candidate: uncommitted changes on `fix/1139-prompt-visible-clicks`, based on
`296c0df5d8eee724cd0f565f85a4b750ec3a193b`. **Historical checkpoint: the
nested-frame keyboard test below blocked this candidate.** See the semantic
follow-up below for the current result. No Git-writing command, remote service,
dependency installation, or owner-browser reload was used.

The HIGH finding is fixed in source: the built input fence forwards
`sink(host,path,e)`, and toast activation and the visibility gate accept the
fence's `KeyboardEvent` as well as pointer clicks. Three built-extension
regressions prove immediate refusal followed by exactly one approved popup
after arming for pointer, Enter, and Space. The shared E2E helpers now wait for
arming, including the blocked-action authority and evasion specs. Direct Trust
and nested-frame Undo helpers also wait. Existing assertions remain intact.

The LOW finding is fixed in the shared `queryPasswordInputs` helper: element
roots use `Element.prototype.querySelectorAll.call`, preserving document/root
support. The analyzer regression models `<input name="querySelectorAll">`
shadowing explicitly, because happy-dom does not reproduce Chrome's named-form
property lookup.

Red evidence before the source fixes:

```text
npx --no-install vitest run tests/content-analyzer-snapshot.test.ts -t "named form control shadows"
Exit 1: 1 failed, 50 skipped; TypeError: root.querySelectorAll is not a function.

CI=1 npx --no-install playwright test tests/e2e/credential-modal-visibility.spec.ts --grep "built toast fence"
Exit 1: all 3 new tests failed, including their retries, waiting for the armed approval's popup.
```

The required checks were run sequentially, with one heavy command at a time:

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Exit 0, including after diagnostic cleanup |
| `npm run lint` | Exit 0; 10 existing warnings in unchanged observatory tests |
| Focused Vitest command below | Exit 0; 4 files, 164 tests passed |
| `npm run build` | Exit 0; interaction-only; worker/profile checks passed |
| `npm run check:content-loader` | Exit 0; revision `ded807920e14`, loader SHA-256 prefix `4fdbbf0b9def` |
| `npm run check:perf-budget` | Exit 0; all 12 budgets passed |
| Five-spec Playwright command below | Exit 1; 38 passed, 1 failed (2.7 minutes) |

```text
npx vitest run tests/credential-modal-visibility.test.ts tests/credential-modal.test.ts tests/ui-toast.test.ts tests/content-analyzer-snapshot.test.ts

CI=1 npx --no-install playwright test tests/e2e/credential-modal-visibility.spec.ts tests/e2e/blocked-action-id-authority.spec.ts tests/e2e/evasion.spec.ts tests/e2e/credential-guard.spec.ts tests/e2e/overlay-cleanup-nesting.spec.ts
```

The failing case is `toast mouse and keyboard controls do not leak
capture-phase input into the protected page` in
`tests/e2e/overlay-cleanup-nesting.spec.ts`. Initially its final assertion found
the original overlay still hidden. A timing trace measured an ancestor
mutation at 1830 ms and focused Undo input at 2210 ms, inside the renewed
800 ms refusal window. The final test waits for the fixture's known
`style-rewritten` phase before arming.

Waiting past that mutation exposed a timeout at the armed keyboard action.
A full rerun with an experimental observer-based test helper also returned
38 passed / 1 failed (6.4 minutes); that helper was removed. Isolated checks
with a phase wait, `noWaitAfter`, and explicit focus plus native keyboard input
also timed out. The last bounded check failed at 20 seconds; default-budget
checks timed out at 120 seconds. Diagnostic logging, the observer helper,
alternative input methods, and the diagnostic timeout were removed. The final
test retains the original `button.press("Enter")` and all original assertions.
There is no passing final five-spec result after cleanup, and the cause is
unclassified, not claimed flaky or pre-existing. Investigation is parked at
the finite gate budget and recorded in `docs/agentic/failure_ledger.jsonl`.

Resume at `pressFrameToastButton` and the hostile fixture's keyboard section:
separate native key delivery and the Undo callback from Playwright's action
completion, then require the exact five-spec command above to pass before merge.
The other 38 cases include the new built-fence pointer/Enter/Space regressions,
the original-closure authority check, Trust persistence, and the evasion Undo cases.

Human Chrome Gate-3 remains **NOT RUN** in `ACTION_ITEMS.md`. No remote CI,
commit, push, or merge is claimed. Occlusion-v2, transforms/blend modes, rAF
hardening, and closing the toast shadow root remain outside this change.

Intended commit message: `fix: relay toast approval events and protect form queries`.

## Mutation-stable arming follow-up (2026-10-24)

Current candidate: uncommitted changes on `fix/1139-prompt-visible-clicks`,
HEAD `ca37dda99bf24b36166b695023a42d48a7a0f1d4`. This section supersedes the
blocked local result in "Independent review fixes" above. The nested-frame
keyboard Undo blocker is **resolved** by a product fix, without a timing bypass.

Both observer delivery and synchronous activation now re-evaluate rendering,
visibility, top-layer state, and hit-testability instead of resetting exposure
just because mutation records exist. Harmless host/`<html>` attribute churn
preserves the 800 ms window. Observed concealment, occlusion, or button removal
invalidates exposure. Each button retains its arming bounding box: more than
1 CSS pixel of change in **any** of x, y, width, or height restarts that button's
window at the newly observed box. Changes up to 1 pixel are tolerated; comparison
against the arming box catches cumulative drift rather than just per-frame jumps.

The existing rendering-gap (>100 ms), click-time coordinates/hit test, focused
keyboard, open-popover, and refusal/pending-decision checks remain. Only animation
frames update the frame timestamp, so repeated mutation samples cannot disguise
a rendering stall. The fixture-specific `style-rewritten` wait was removed from
the keyboard Undo spec. Its original `button.press("Enter")`, assertions, and
ordinary shared arming delay remain; no compensating wait was added.

Red evidence:

- Before the product fix, `npx --no-install vitest run tests/credential-modal-visibility.test.ts`
  returned exit 1: 6 failed, 13 passed. Attribute churn refused a visible approval;
  all four geometry components and cumulative movement incorrectly kept arming.
- The first implementation passed all 39 browser cases, but a focused rendering-gap
  regression exposed mutation samples refreshing the frame timestamp:
  `npx --no-install vitest run tests/credential-modal-visibility.test.ts -t 'rendering gap'`
  returned exit 1: 1 failed, 21 skipped. Updating the timestamp only in the animation
  callback fixed that regression before the final complete proving pass below.

Final required proving, run sequentially with one heavy command at a time:

| Command | Exact final result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0; 0 errors, 10 warnings in unchanged observatory tests |
| `npx vitest run tests/credential-modal-visibility.test.ts tests/credential-modal.test.ts tests/ui-toast.test.ts` | Exit 0; 3 files, 123 tests passed (1.94 s) |
| `npm run build` | Exit 0; interaction-only; loader identity, 9 worker modules, and release-profile checks passed |
| `npm run check:perf-budget` | Exit 0; all 12 budgets passed |
| Five-spec Playwright command below | Exit 0; 39 passed (2.5 minutes), no retries, 1 worker |

```text
CI=1 npx --no-install playwright test tests/e2e/overlay-cleanup-nesting.spec.ts tests/e2e/credential-modal-visibility.spec.ts tests/e2e/blocked-action-id-authority.spec.ts tests/e2e/evasion.spec.ts tests/e2e/credential-guard.spec.ts
```

PowerShell set `CI` to `1` for the Playwright command. The new unit cases cover
ongoing and queued harmless mutations, observed hiding between frames, x/y/size
changes without mutations, removal/reinsertion, tolerated jitter, cumulative
drift, and rendering gaps despite attribute churn. All existing visibility
refusals and toast keyboard cases remain green. The originally failing capture-
phase keyboard Undo E2E passed on its first attempt in both complete browser runs.

Final artifact: this worktree's `extension/dist`; UI guard revision
`3edbaf9e2c82`, loader SHA-256 prefix `738d106b6bad`. Exact bytes: visibility
chunk 2,240; toast chunk 8,012 / 8,192; credential entry 30,937 / 32,256;
MAIN entry 21,484 / 21,504; total dist with normalized packaged LICENSE
540,789 / 552,960. No budget, gate, dependency, or MAIN source was changed.
`node_modules` remains a junction; no dependency installation was performed.

**NOT verified:** full-suite `npm test`, remote CI/review, owner extension reload,
or human Chrome Gate-3. `ACTION_ITEMS.md` retains the branch-held #1139 human
checks. Hostile CSS can still deny availability; filters, masks, and clipping
remain conservative refusals. No Git-writing command, commit, push, merge, or
remote-service operation is claimed.

Intended commit message: `fix: preserve approval arming through harmless DOM mutations`.
