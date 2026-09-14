# Bounded MutationObserver delivery in reserve tests (#693)

## Failure boundary

Issue #693 records a hosted failure before the reserve/product assertions: a
single synchronous observer drain found no pending records, while repeated
fresh-process runs of the identical product code passed. A successful rerun does
not repair the scheduling assumption.

The reserve suite now awaits a test-only delivery handshake at both baseline and
flood mutations. Each of at most eight attempts drains real observer records and
checks the monitor-owned pending count. A failed probe yields one microtask before
the next drain. Success returns immediately; exhausting the fixed bound throws.
A drain/probe exception is never caught or converted to success. The helper has
no shared state, timer advancement, sleep, retrying product action or skip path.

The test suite still owns its explicit 200 ms debounce advances. Its
`shouldAdvanceTime: false` setting, all 69 existing cases and every product
assertion are unchanged. The old intermediate one-shot readiness assertion is
replaced, not weakened into a broad timeout. Alert caps, scarce reserve accounting,
per-element charging, shadow-root cleanup and opt-in overlay behavior are not
modified. No file under `extension/` changes.

## Verification

The added helper regression file covers immediate delivery, all seven permitted
microtask delays (including success on the final attempt), exact-bound failure,
drain/probe error propagation, no timer advancement and independent invocations.

Locally executed on Node 22.16.0: an out-of-tree runner executes the actual
TypeScript helper through the available TypeScript 5.8.3 transpiler. All 12
contracts passed, including a source comparison preserving both awaited callsites,
every remaining `expect` line and all fake-clock configuration/advance lines.
Syntax transpilation and `git diff --check` passed. This is supplementary
validation, not a Vitest or happy-dom result.

The local sandbox has no installed lockfile dependencies and registry access was
unavailable. Required qualification remains exact-source hosted runs of:

```sh
npm ci
npm run lint
npm run typecheck
npx vitest run tests/mutation-observer-delivery.test.ts
# Execute each invocation in a fresh process; do not use retry mode.
for attempt in $(seq 1 30); do
  npx vitest run tests/mutation-monitor.test.ts -t 'emits the credential signal for a shadow root registered after a benign flood' || exit 1
done
for attempt in $(seq 1 15); do
  npx vitest run tests/mutation-monitor.test.ts || exit 1
done
npm test
```

Do not exclude an unrelated test to manufacture a green default suite. Record the
exact tested commit and counts in the PR. This bounded fixture synchronization
repair is not new real-browser prevention evidence. Test-only changes do not
require human Gate-3 under `CLAUDE.md`; fresh applicable review still applies.
