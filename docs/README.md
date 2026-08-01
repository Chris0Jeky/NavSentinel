# NavSentinel Docs

This folder mixes current operating documents with explicitly dated historical
analysis. Use the labels below rather than assuming every page describes the
current merged `main` branch.

## Start here

- `docs/Product_Strategy.md`
  - **Current product thesis, intended user, portfolio boundaries, and beta/public-launch evidence gates.**
- `docs/Project_Overview.md`
  - Product summary, protection model, and user-visible capabilities.
- `docs/Architecture_and_Data_Flow.md`
  - Current runtime layers, bridge design, service-worker responsibilities, and state flow.
- `docs/Intent_Model_and_Scoring.md`
  - Navigation CDS and credential-risk heuristics.
- `docs/Testing_and_Gym.md`
  - Current test surfaces, Gym coverage, and local/CI verification flow.

## Project analysis

- `docs/Strategic_Outlook.md`
  - Dated 2026-07-02 input. Superseded for current product direction by `Product_Strategy.md`.
- `docs/Course_Correction.md`
  - Dated 2026-07-02 input. Its inner-loop/outer-loop diagnosis remains useful; current actions live in `Project_Roadmap.md`.
- `docs/Comprehensive_Project_Analysis.md`
  - Full repo analysis with architecture deep dive, metrics, gap analysis, scorecard, and recommended roadmap. Generated 2026-04-09.
- `docs/Product_Thesis_Review.md`
  - Critical product thesis evaluation: security value, usability, competitive positioning, expansion strategy, testing methodology. Generated 2026-04-09.

## Project planning

- `docs/Project_Roadmap.md`
  - **The active execution document.** Current outcome gates followed by the historical 47-task implementation registry.
- `docs/NORTHSTAR_ROADMAP.md`
  - Post-beta option portfolio. It does not authorize current work.
- `docs/HORIZON_EPICS.md`
  - Post-beta option portfolio from the 2026-07-07 design initiative. Frozen pending evidence and maintainer cull; it is not an active backlog.
- `docs/REDESIGN_ORCHESTRATION.md`
  - UI redesign plan (9 phases, R1–R9). Complete as of 2026-05-16.
- `docs/STORE_LISTING.md`
  - Pointer to the canonical Chrome Web Store material under `docs/cws-listing/`.

## Active operational docs

- `autodoc/AGENT_INDEX.md`
  - Fast agent-facing map of code seams, context traps, and verification hints.
- `docs/agentic/`
  - Question, failure, guide-update, Git recovery, and optional skill-routing
    notes for agent-driven work. There is no repository-local harness or
    Claude/Codex parity contract.
- `docs/Demo_Showcase_Plan.md`
  - The active plan for the guided demo variants and record-mode rollout.
- `docs/Testing_Expansion_Strategy.md`
  - Longer-horizon plan for broader, deeper, and stress-oriented automated coverage.
- `docs/Real_World_Adversarial_Program.md`
  - Scenario backlog for realistic dangerous browser situations and how they should be tested.
- `docs/Checklists.md`
  - Day-to-day verification and release checklists.
- `docs/RELEASING.md`
  - Versioning, packaging, CI, and release artifact guidance.

## Supporting design docs

- `docs/Threat_Model_and_Cases.md`
  - Threat scenarios the extension is trying to catch or intentionally allow.
- `docs/Snippets_By_Topic.md`
  - Useful code-entry points and commands for common tasks.

## Historical and archived docs

- `docs/archive/MasterPlan.md`
  - Original baseline proposal and scope framing.
- `docs/archive/Expansion_Tracker.md`
  - Merge-era tracker from the SentinelSuite integration branch.
- `docs/archive/Resource_Map.md`
  - Merge-era map of `RESOURCES/` inputs and entry points.
- `docs/archive/Execution_Tracker.md`
  - Post-merge batch tracker (Batches 1-7). Superseded by `Project_Roadmap.md`.
- `docs/archive/Implementation_Roadmap.md`
  - Post-merge follow-up themes. Superseded by `Project_Roadmap.md`.
- `docs/archive/README.md`
  - Archive index and guidance.

## Related root docs

- `README.md`
- `CONTRIBUTING.md`
- `PRIVACY.md`
- `SECURITY.md`
