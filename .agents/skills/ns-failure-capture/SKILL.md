---
name: ns-failure-capture
description: Classify and record tool, test, dependency, docs, browser, and workaround failures.
user-invocable: true
---

# NavSentinel Failure Capture

Name the surface, classify as blocker/non_blocking_risk/pre_existing_noise/invalid_signal, decide whether work can continue, and record recurring or instructive failures in `docs/agentic/failure_ledger.jsonl` or `FAILURE_LEDGER.md`.

Use `docs/agentic/GUIDE_UPDATE_PROTOCOL.md` before promoting a lesson into root guidance.

Zero-skip rule: no classification is an excuse to ignore a finding. Every failure must be fixed in the current work or seeded as a concrete follow-up (GitHub issue, roadmap entry, or failure ledger entry with a fix path). "Non-blocking" means it does not block the current task, but it must still be addressed or tracked. No tech debt accrual from skipped findings.

Final handoff must include failure, classification, impact, workaround, and future fix when unresolved.
