# Issue #1139: visible credential and toast approvals

Branch: `fix/1139-prompt-visible-clicks`. Base HEAD:
`ff7f684b1ba3fc7524665e2226e422c635b38799`. Results below cover the
uncommitted worktree changes, not that base commit alone.

## Per-item status

- MEDIUM credential approval: implemented. The host and button must be rendered,
  the supported popover must be open, and document/shadow hit tests must reach
  the button at the click coordinates. Focused keyboard clicks use its center.
  Visibility is sampled every animation frame; relevant mutations, rendering
  gaps, concealment, and refused clicks reset arming. The 800 ms delay reuses
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

Final required proving results:

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

## Exact budget bytes

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
