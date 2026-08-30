# Metrics methodology

Report denominators, confidence intervals where meaningful, exact profile/build, partitions, invalid runs, and missing visibility. Do not publish one blended security score.

## Required measures

- **Harm outcomes:** count and rate each exact outcome by scenario family, capability, profile, and severity.
- **Pre-harm efficacy:** `HELD_PRE_HARM + BLOCKED_PRE_HARM` divided by valid malicious/mixed runs whose harm boundary is observable.
- **Post-commit containment:** report `ROLLED_BACK_POST_COMMIT` and `RECOVERED_AFTER_EXPOSURE` separately from pre-harm efficacy.
- **False intervention:** benign runs that are warned, held, blocked, or broken, with the intervention type and task-completion impact.
- **Invalidity:** `TEST_INVALID` count and reason. Never remove invalid runs silently or treat them as passes.
- **Robustness:** survivor rate and benign-control regression across declared mutation axes and budgets.
- **Browser qualification:** supported branded browser/version, persistent-profile lifecycle, accessibility, readiness, and state boundaries.
- **Performance and privacy:** latency distributions, CPU/memory where scoped, permission/profile diff, retained fields, and verified absence of unauthorized egress.

Comparisons require the same fixture partition, oracle, browser, readiness contract, and consequence boundary. Universal security, anonymity, and unsupported coverage claims are prohibited.
