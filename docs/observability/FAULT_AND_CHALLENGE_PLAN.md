# Observatory fault and challenge continuation

Date: 2026-09-13. Base: PR #705, tree `5e633a8a689f4a6682c33a21026d46d61b093389`.
Implements the owner's approved continuation of #700/#701. Does not activate #702.

## Design and boundaries

Reuse the exact-input wrapper, existing overlay fixture, receiver, recorder and
viewer. Separate three lanes: ordinary four-arm protection comparisons, deliberately
broken-observer trials, and newly frozen timing/viewport challenges. A test-system
check may pass precisely because its protection evidence becomes inconclusive.
Never merge those two outcomes into a single green prevention count.

Alternatives considered: cloning the browser harness (rejected: fixes would drift),
and starting with live collection (deferred: unresolved consent/export prerequisites
and it would not test the existing recorder). Extract a shared test-only harness
without changing extension code. Fault drivers alter actual local browser/receiver
resources, while normal observation and validation decide whether the gap appears.

## Implementation sequence

1. Add failing recorder tests: a gap has a timestamped event; repeated identical gaps
   do not flood the timeline; overflow retains fault category and terminal state.
   Implement bounded fault events and strict fault-code validation.
2. Add a declarative fault contract and negative controls. An injection announcement
   alone cannot qualify. Require the corresponding receiver health/counter change,
   browser frame/document transition, worker stop/restart observations or actual
   dropped events with retained harm. Never rewrite the original trace verdict.
3. Extract `observatory_overlay_harness.ts`; keep the existing stable/reinsertion
   four-arm assertions. Add explicit fault drivers for receiver shutdown, primary
   frame removal/replacement, worker stop/restart, page-report flood and receiver
   observer callback failure. Emit traces in finally, including incomplete trials.
4. Add a dedicated zero-retry fault Playwright config and exact-input wrapper lane.
   Build an offline report and machine-readable fault qualification separately from
   ordinary campaign support. Include missing/duplicate/unknown trials as failures.
5. Freeze two extra timing/viewport combinations before their first browser run;
   keep detector settings unchanged. Record baseline/protected/benign/mixed arms
   and detailed/minimal observation separately. Once inspected these are regression
   challenges, not a perpetually unseen or independent attack corpus.
6. Qualify Node contracts, receiver tests, lint/typecheck, default units, both build
   profiles and budgets; execute actual faults/challenges on hosted Chromium where
   local managed policies disallow navigation. Inspect output, submit all source,
   docs/tests via draft PR and update #700/#701 with exact-head results and limits.

## Evidence ceilings

Receiver shutdown is detected through real HTTP health challenges; the health path
must not consume a consequence authority. Worker stop/start uses Chromium's
experimental ServiceWorker CDP domain in a disposable test profile, not extension
reload or chrome://extensions automation. A command acknowledgement is not a stop
receipt: require observed stop and a new worker epoch. CDP versions may differ.

A frozen challenge is only held out from the preceding implementation, not from
this developer's knowledge, nor a statistical open-web efficacy sample. Keep first
qualification failures; do not tune the product or change expected outcomes to get
green. Live session collection and child-form protection remain separate dependency
lanes; existing PR #698 must not be silently merged to satisfy an inspector test.

## Primary references

- https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/
- https://playwright.dev/docs/service-workers
- https://playwright.dev/docs/chrome-extensions

Reviewed 2026-09-13. Test against the repository's locked Playwright version rather
than assuming current documentation guarantees the installed runner's lifecycle.
