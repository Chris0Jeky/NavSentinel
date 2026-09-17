# Options import/write ordering (#690)

## Contract

This is a same-Options-instance transaction boundary, not a new storage authority
or a global transaction across browser contexts. Save, the 250 ms autosave, and
changes to the autosave preference use one FIFO write coordinator. Selecting an
import locks admission synchronously, cancels the outstanding timer, drains
previously admitted settings writes, then dispatches exactly one import.
Writes and duplicate imports attempted after admission closes are ignored, not
queued to overwrite the eventual imported snapshot. Worker sender authorization,
narrow settings patches, expected-baseline conflict checks and the existing
whole-import owner remain unchanged.

While an import is pending, the Options shell is inert and marked busy. An
outside live status explains why controls are unavailable. A capture-phase event
fence also rejects synthetic UI activation; disabled controls alone are not the
ordering mechanism. Previous inert/busy attributes are restored in finally.

## Success, failure and concurrent notifications

A successful import, or a known prompt-data delivery failure after core settings
committed, makes the persisted settings authoritative over the local draft,
including incomplete numeric input. The existing partial-result warning remains.

An ordinary failure refreshes canonical persistence and rebases the untouched
local draft over it. Same-leaf conflicts and incomplete/invalid numeric text stay
visible. The cancelled autosave is re-armed only after the lock releases, and only
for a dirty, valid, conflict-free draft with autosave enabled. Manual mode remains
manual. This applies to malformed JSON and mid-import errors; an ambiguous worker
response is never retried/replayed automatically.

Storage notifications during import are deferred rather than rebasing the draft
through intermediate imported states. A notification received during the settings
read takes precedence over that read, consistent with the existing UI convention.
A later notification during panel refresh is reconciled before unlocking. This
is not a cross-context revision protocol: worker conflict checking remains the
last-write safety boundary and every recovery save first reads persistence again.

A failed settings/preference operation cannot poison the queue. Unexpected
refresh failures still restore the UI; a later save reconciles persistence before
sending any narrow patch. This does not make unrelated data-lane operations or
multi-context imports globally atomic.

## Regression evidence

`tests/options-write-coordinator.test.ts` has four deterministic promise-ordering
cases: earlier writers drain, later writers are rejected, duplicate imports are
not queued, and failures release rather than poison the queue.

`tests/options-import-ui.test.ts` loads the actual Options HTML and entry module
under happy-dom. It uses real patch/rebase logic with mocked persistence transport
and fake timers, not a second implementation of the UI. Ten cases cover failed
JSON recovery, an in-flight preference, a dispatched Save, successful authoritative
replacement, known partial delivery, manual/invalid/conflicting drafts, a late
storage notification and narrow-field rebasing. All values are synthetic.

On pinned main `476301ad1c4b56fc83ed335ac83e343dc93d675e`, replacing only the
Options entry with the original source makes two of the ten UI tests fail:
the stranded dirty autosave and the missing in-flight preference/import lock.
All ten pass with this implementation; the four coordinator tests also pass.

Local qualification (Node 22.16.0, lockfile dependencies): typecheck, lint and the
full suite pass: **3,296 tests across 119 files**, including 14 new tests.
Both profile builds and unchanged performance budgets pass: interaction-only
494.6 KiB / 500 KiB (12 checks), research-reputation 498.0 KiB / 500 KiB (13 checks).

```sh
npm run typecheck
npm run lint
npm test
npm run build && npm run check:perf-budget
npm run build:research-reputation && npm run check:perf-budget
```

Normal exact-head CI, applicable independent review and owner Chrome/UI
acceptance remain required. A DOM test is not a branded-Chrome acceptance receipt.
This branch does not change permissions, detection/scoring, form navigation,
storage schemas, dependencies, or the existing owner-waiver scope.
