# Evidence index

Generated from the evidence vocabulary, scenario registry, and existing-evidence reconciliation. Do not edit this view by hand.

An outcome describes what the independent harm oracle observed. An evidence state describes how well a scenario or capability has been substantiated. A product event, toast, hidden element, or rollback is not by itself proof of protection.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| NO_SIGNAL | The product observed nothing relevant. |
| OBSERVED | Evidence was recorded without user-facing action. |
| ANNOTATED | Passive information was shown. |
| WARNED | A warning was shown, but the harmful sink remained reachable without a separate trusted decision. |
| HELD_PRE_HARM | The consequence was paused before the declared harm boundary. |
| BLOCKED_PRE_HARM | The consequence was prevented before the declared harm boundary. |
| ROLLED_BACK_POST_COMMIT | A destination committed and was then reversed; exposure may have begun. |
| RECOVERED_AFTER_EXPOSURE | The product helped after harmful exposure or state change began. |
| HARM_REACHED | The local sink received or committed the protected consequence. |
| NOT_APPLICABLE | The scenario does not exercise the selected capability or profile. |
| TEST_INVALID | Harness, browser, readiness, network, or attribution failure invalidated the result. |

## Evidence states

| Order | State | Meaning | Canonical scenarios | Existing mappings |
| --- | --- | --- | --- | --- |
| 0 | UNMODELLED | Seed only. | 168 | 2 |
| 1 | MODELLED | Invariant, boundary, malicious, benign, and mixed contracts were reviewed. | 0 | 60 |
| 2 | FIXTURE_PROVEN | The safe malicious path reaches the local harm sink and controls reproduce. | 0 | 0 |
| 3 | REGRESSION_PROVEN | The product handles the declared fixture and controls with an independent oracle. | 0 | 1 |
| 4 | ROBUSTNESS_PROVEN | Declared adjacent mutations and benign duals pass within a recorded budget. | 0 | 0 |
| 5 | BROWSER_PROVEN | Supported branded-browser lifecycle, accessibility, privacy, and performance qualification is complete. | 0 | 0 |
| 6 | EFFICACY_MEASURED | Credible corpus or holdout and false-intervention evidence exists. | 0 | 0 |
| 7 | RELEASE_ELIGIBLE | Profile, claims, permissions, package, privacy, and required gates align. | 0 | 0 |

## Reconciled evidence validity

| Validity | Count |
| --- | --- |
| CURRENT_REGRESSION | 59 |
| STALE | 1 |
| INVALID | 1 |
| UNVERIFIED | 2 |

## Fixture safety holds

| Disposition | Mapped records | Fixture paths |
| --- | --- | --- |
| CLEAR | 42 | 0 |
| SAFETY_HOLD | 21 | 21 |
| QUARANTINED | 0 | 0 |

Safety-held and quarantined fixtures are excluded from programme evidence promotion until localized and reconciled.
