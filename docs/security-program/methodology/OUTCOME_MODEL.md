# Outcome and evidence model

## Independent harm oracle

Every experiment declares one primary harm boundary before implementation. Its oracle must observe the consequence independently of NavSentinel's event stream or UI. A local fake sink receipt, final browser URL/context, protected-data sentinel receipt, file-state sentinel, or explicit state transition can be an oracle. A toast, log line, score, warning, removed element, or rollback alone cannot.

Record exactly one outcome for the selected capability/profile:

| Outcome | Use when |
| --- | --- |
| `NO_SIGNAL` | The product observed nothing relevant. |
| `OBSERVED` | Evidence was recorded with no user-facing action. |
| `ANNOTATED` | Passive information was shown. |
| `WARNED` | A warning appeared, but the sink remained reachable without a separate trusted decision. |
| `HELD_PRE_HARM` | The consequence paused before the declared harm boundary. |
| `BLOCKED_PRE_HARM` | The consequence was prevented before the declared harm boundary. |
| `ROLLED_BACK_POST_COMMIT` | A destination committed and was reversed; exposure may already have begun. |
| `RECOVERED_AFTER_EXPOSURE` | Assistance occurred after exposure or state change began. |
| `HARM_REACHED` | The local sink received or committed the protected consequence. |
| `NOT_APPLICABLE` | The scenario does not exercise the selected capability/profile. |
| `TEST_INVALID` | Harness, browser, readiness, network, or attribution failure invalidated the result. |

Evidence promotion is monotonic only when all prior contracts still hold:

`UNMODELLED` -> `MODELLED` -> `FIXTURE_PROVEN` -> `REGRESSION_PROVEN` -> `ROBUSTNESS_PROVEN` -> `BROWSER_PROVEN` -> `EFFICACY_MEASURED` -> `RELEASE_ELIGIBLE`

A state may be downgraded whenever its evidence expires, becomes contaminated, no longer exercises the current build/profile, or loses its independent oracle. Promotion requires a receipt with exact build, browser, fixture, oracle, outcome, limitations, and verification paths.
