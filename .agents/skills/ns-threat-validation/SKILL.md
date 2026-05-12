---
name: ns-threat-validation
description: Validate NavSentinel detection and false-positive behavior across Gym, corpus, FP measurement, stress, and adversarial scenarios.
user-invocable: true
---

# NavSentinel Threat Validation

References: `docs/Threat_Model_and_Cases.md`, `docs/Intent_Model_and_Scoring.md`, `docs/Testing_and_Gym.md`, `docs/Real_World_Adversarial_Program.md`.

Ask: affected attack family, reason codes, legitimate flows, deterministic proof, and whether corpus/FP/stress evidence is needed.

Evidence lanes: unit tests for model behavior, targeted Playwright for browser behavior, Gym fixture plus E2E for local scenarios, corpus for phishing snapshots, FP measurement for noise claims, stress for lifecycle/churn.

Do not claim additive security value without test or measurement evidence.
