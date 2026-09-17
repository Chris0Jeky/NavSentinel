# Bounded MutationObserver delivery in reserve tests (#693)

## Failure boundary

Issue #693 records a hosted failure before the reserve/product assertions: a
single synchronous observer drain found no pending records, while repeated
fresh-process runs of the identical product code passed. A successful rerun does
not repair the scheduling assumption.

The reserve suite now awaits a test-only delivery handshake at both baseline and
flood mutations. Each of at most eight attempts drains real observer records and
checks the monitor-owned pending count. After an unsuccessful attempt, the helper
yields one real Node event-loop turn through a native `setImmediate` captured
before Vitest enables fake timers. Pending microtasks therefore run before the
next drain, while the monitor's fake debounce and auto-disconnect timers remain
frozen. Success returns immediately; exhausting the fixed bound throws. A
drain/probe exception is never caught or converted to success. The helper has no
shared state, fake-timer advancement, sleep, retrying product action or skip path.

The test suite still owns its explicit 200 ms debounce advances. Its
`shouldAdvanceTime: false` setting, all 69 existing cases and every product
assertion are unchanged. The old intermediate one-shot readiness assertion is
replaced, not weakened into a broad timeout. Alert caps, scarce reserve accounting,
per-element charging, shadow-root cleanup and opt-in overlay behavior are not
modified. No file under `extension/` changes.

## Verification

The helper regression file covers immediate delivery, delivery after each of the
seven permitted real event-loop yields (including success on the final attempt),
exact-bound failure, drain/probe error propagation, no fake-timer advancement and
independent invocations. One regression deliberately schedules delivery through
the captured native `setImmediate` while a fake 1 ms timer must remain pending.

Hosted qualification replayed the test-only red commit, then verified the fixing
head with 12/12 focused helper contracts. The formerly flaky shadow-root case
passed in 20/20 fresh Node 20 processes, and the complete 69-case mutation-monitor
suite passed in each of five fresh processes. Focused lint and full TypeScript
typecheck also passed. Normal CI then passed on the exact final code head before
this documentation correction.

For requalification, run:

```sh
npm ci
npm run lint
npm run typecheck
npx vitest run tests/mutation-observer-delivery.test.ts
# Execute each invocation in a fresh process; do not use retry mode.
for attempt in $(seq 1 20); do
  npx vitest run tests/mutation-monitor.test.ts -t 'emits the credential signal for a shadow root registered after a benign flood' || exit 1
done
for attempt in $(seq 1 5); do
  npx vitest run tests/mutation-monitor.test.ts || exit 1
done
npm test
```

Do not exclude an unrelated test to manufacture a green default suite. Record the
exact tested commit and counts in the PR. This bounded fixture synchronization
repair is not new real-browser prevention evidence. Test-only changes do not
require human Gate-3 under `CLAUDE.md`; fresh applicable review still applies.
