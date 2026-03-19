# MasterPlan

This file is now a historical baseline for the original NavSentinel proposal. It is still useful for understanding the initial product intent, but it no longer describes the full current branch by itself.

For the current implementation, start with:

- `README.md`
- `docs/README.md`
- `docs/Project_Overview.md`
- `docs/Architecture_and_Data_Flow.md`

## Original product intent

The original project aimed to reduce malicious-by-design navigations that abuse real user interaction, especially:

- deceptive overlays and clickjacking
- forced new tabs or popunders
- programmatic clicks
- redirect-style navigation abuse

The design principles from the original proposal are still valid:

- use short-lived user-intent signals
- keep the decision model explainable
- avoid remote classification and telemetry
- prefer bounded prompts over silent breakage when intent is ambiguous

## What changed since the initial plan

The current branch now goes beyond the original navigation-only baseline and includes:

- a hardened main-world / isolated-world bridge
- password-submit protection
- trusted-domain management
- a popup and expanded options page
- a bounded local event log
- packaging and CI support

## Historical roadmap status

The original staged roadmap has effectively been overtaken by the merged SentinelSuite work. The practical follow-up roadmap now lives in:

- `docs/Implementation_Roadmap.md`
- `docs/Expansion_Tracker.md`
