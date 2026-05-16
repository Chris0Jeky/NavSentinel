---
name: ns-threat-validation
description: Validate NavSentinel detection and false-positive behavior across Gym, corpus, FP measurement, stress, and adversarial scenarios.
user-invocable: true
---

# NavSentinel Threat Validation

Use when work affects detection efficacy, threat coverage, false positives, or product security claims.

## References

- `docs/Threat_Model_and_Cases.md`
- `docs/Intent_Model_and_Scoring.md`
- `docs/Testing_and_Gym.md`
- `docs/Real_World_Adversarial_Program.md`
- `docs/Testing_Expansion_Strategy.md`

## Validation Questions

1. What attack family or false-positive class is affected?
2. Which reason codes or risk factors should change?
3. Which legitimate flow must remain allowed?
4. Which deterministic Gym page or unit test proves the behavior?
5. Is corpus, FP, live, or stress validation required before making a claim?

## Evidence Lanes

- pure scoring/model: `npm run test`
- browser behavior: targeted Playwright spec
- realistic local scenario: Gym fixture plus E2E
- known phishing snapshots: `npm run test:e2e:corpus`
- false-positive measurement: `npm run measure:fp`
- lifecycle/timing/churn: `npm run test:e2e:stress`

## Guardrails

- Do not claim additive security value without a test or measurement.
- Keep local-first behavior intact.
- Record false-positive risk explicitly when changing thresholds.
- Update threat/scoring/testing docs when the model changes.
