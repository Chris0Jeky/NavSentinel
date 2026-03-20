# Expansion Tracker

Archived on 2026-03-19 after PR #1 merged to `main`.

This file captures the merger-era worktree, slice tracking, and resume notes that were
useful during the SentinelSuite integration. It is preserved for historical context only.

The worktree, branch, resume, and decision notes below are intentionally retained as history.
They are not current operational guidance for the merged `main` branch.

## Purpose
- Keep a compact, durable record of what was discovered in `RESOURCES/`, what has been integrated, what is pending, and what should be carried forward if context is compacted.
- Treat `RESOURCES/suite/SentinelSuite` as the primary code integration source.
- Treat `RESOURCES/release/SentinelSuite` as process and packaging follow-up material.
- Treat `RESOURCES/link` and `RESOURCES/hardened` as optional companion-project inputs, not phase-one merge targets.

## Worktree
- Main integration worktree: `../NavSentinel-codex-expansion`
- Source repo with `RESOURCES/`: `../NavSentinel`
- Branch: `codex/resource-expansion`

## Resource Map
- `RAW_TRANSCRIPT.txt`
  - Intent: harden NavSentinel, improve product UX, add local observability, add credential-submit protection, then package it credibly.
- `suite/SentinelSuite`
  - Primary code delta for the extension.
  - Main additions: authenticated message bridge, keyboard-safe click context, popup UI, unified settings/event log/trusted domains, credential guard, richer options page.
- `release/SentinelSuite`
  - Same general code shape plus release automation, docs, CI, packaging scripts.
- `credentials/CredentialSentry`
  - Original standalone source for the credential-submit feature family.
- `link` and `hardened`
  - Python URL-analysis companion project; defer until extension merge is stable.

## Integration Slices
- Slice 1: Tracking and context compaction support.
- Slice 2: Security hardening for main-world / isolated-world messaging.
- Slice 3: Keyboard-safe click context and existing-nav improvements.
- Slice 4: Unified storage and local event log.
- Slice 5: Toolbar popup and expanded options UI.
- Slice 6: Credential-submit guard and trusted-domain model.
- Slice 7: Tests for the merged feature set.
- Slice 8: Release/process polish from `RESOURCES/release`.

## Compact Context Summary
- Current repo already has a functioning navigation-intent firewall with capture-phase click analysis, main-world patches for popup/redirect/form gating, allowlist storage, and rollback logic.
- Highest-value merge target is `RESOURCES/suite/SentinelSuite`.
- Expect resource code to need integration cleanup rather than blind copying.
- First implementation goal is a stable merged extension, not full release automation.

## Progress
- [x] Repo reconnaissance completed.
- [x] `RESOURCES/` reconnaissance completed.
- [x] Separate integration worktree created.
- [x] Tracker created and kept updated as slices land.
- [x] Slice 2 merged.
- [x] Slice 3 merged.
- [x] Slice 4 merged.
- [x] Slice 5 merged.
- [x] Slice 6 merged.
- [x] Slice 7 merged.
- [~] Slice 8 partially merged.
- [x] Verification run completed.
- [x] Slice 8 CI test-discovery fix landed.
- [x] Documentation sweep aligned with the merged suite behavior.

## Landed Changes
- Slice 2
  - Main-world and isolated-world control messages now relay through the extension runtime, with a one-way fallback for passive main-world notifications.
- Slice 3
  - Keyboard-triggered clicks now produce explicit click context and feed the existing navigation decision path.
- Slice 4
  - Storage model expanded to suite settings, trusted domains, import/export, and a bounded local event log.
- Slice 5
  - Added toolbar popup and expanded options page for nav mode, credential mode, trusted domains, allowlist, and log management.
- Slice 6
  - Added password-submit interception, trusted-domain workflow, risk scoring, and modal-based allow/cancel flow.
- Slice 7
  - Added credential-domain unit coverage and a Level 11 Gym + Playwright flow for risky password submit prompts.
- Slice 8
  - Added version-parity verification, cross-platform extension packaging, CI workflow scaffolding, release/docs hygiene, extension icons, and a full `tsc --noEmit` cleanup under `exactOptionalPropertyTypes`.

## Verification
- `npm run build`
  - Passes in the integration worktree.
- `npm run test`
  - Passes after widening Vitest include patterns to cover top-level `tests/**/*.test.ts`.
- `npm exec playwright test tests/e2e/credential-guard.spec.ts`
  - Passes.
- `npm run verify:versions`
  - Passes after aligning `package.json` and `extension/manifest.json` on `0.2.0`.
- `npx tsc -p tsconfig.json --noEmit`
  - Passes without relaxing compiler strictness.
- `npm run package:ext`
  - Passes and emits `artifacts/navsentinel-v0.2.0.zip`.
- `npm exec playwright test tests/e2e/navsentinel.spec.ts tests/e2e/credential-guard.spec.ts`
  - Passes for the local Gym suite, with two intentionally env-gated skips (`ROLLBACK_E2E`, `LIVE_E2E`).
- `npm run test:e2e`
  - Passes after adding `playwright.config.ts` so Playwright only discovers `tests/e2e/**/*.spec.ts` and does not load Vitest unit files.

## Resume State
- The merged extension is now functionally ahead of the original NavSentinel baseline and aligned with the main `SentinelSuite` product direction.
- The remaining work is now mostly optional repo/process follow-up: release-tag automation, issue templates, changelog workflow, and any future companion-project integration from `RESOURCES/link` or `RESOURCES/hardened`.
- If context is compacted, resume from the worktree above, read this tracker first, then compare against `RESOURCES/release/SentinelSuite` for packaging/docs/CI deltas.

## Decisions
- Use the separate worktree for all edits.
- Merge selectively from `suite` instead of replacing the repo wholesale.
- Keep LinkSentry integration out of the first implementation pass.

## Next Actions
- Decide whether to broaden CI beyond the current build/unit/E2E/package path.
- Triage remaining release artifacts such as release-tag automation, changelog workflow, and issue templates.
- Expand E2E coverage around popup/options workflows and trusted-domain decisions if the next pass stays feature-focused.
