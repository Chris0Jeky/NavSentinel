# NavSentinel repository guide

NavSentinel is a local-first Chrome MV3 extension built with TypeScript, Vite,
Vitest, and Playwright. It protects abuse-heavy browser surfaces including
deceptive navigation, risky credential submits, DoubleClickjacking, and
ClickFix/fake-CAPTCHA overlays. The project is a pre-release private alpha and
has zero runtime network calls by design.

Owner decision #499 (2026-07-31) retired the repository-local agent harness.
There is no project tier, lifecycle hook, command floor, agent-validation
script, or Harness CI job. Do not recreate those surfaces without a new
explicit owner decision. User- or runtime-level settings outside this
repository are separate and are not described or verified here. `.mcp.json`
contains optional credential-free tooling, not an enforcement layer.

## Start here

- `autodoc/AGENT_INDEX.md` maps product seams to focused verification.
- `docs/Project_Roadmap.md` and live GitHub issues hold execution truth.
- `ACTION_ITEMS.md` holds human-owned decisions and manual checks; use stable
  `AI-N` identifiers when working that queue.
- Source is under `extension/src/`; `extension/dist/` is generated output.

Avoid bulk-reading `node_modules/`, generated output, `test-results/`,
`playwright-report/`, `artifacts/`, `RESOURCES/`, `HistoryDump.txt`, and
`docs/archive/` unless the task needs their provenance.

## Product invariants

- No runtime telemetry, remote fetch, credential exfiltration, or password-value
  storage. Bundled resources loaded with `chrome.runtime.getURL(...)` remain
  local and are allowed.
- Keep MAIN-world patches narrow, validate every bridge message, persist
  short-lived critical state in `chrome.storage.session`, and cover every
  required frame.
- Do not edit `extension/dist/` or generated reputation/top-site artifacts.
- Keep navigation, credential, service-worker, and UI changes separate unless
  the behavior crosses those seams.
- The bundled `reputation_data.bin` is a reserved-domain test fixture, not user
  protection. Do not make reputation claims from it.

## Focused verification

| Changed seam | Proving command |
| --- | --- |
| TypeScript | `npm run typecheck` and `npm run lint` |
| One unit seam | `npx vitest run tests/<name>.test.ts` |
| Shared/content/service-worker logic | `npm test` |
| Manifest, worker imports, bundling | `npm run build` |
| MAIN-world guard, bridge, detections | `npm run build` then `npm run test:e2e` |
| Service-worker lifecycle/rollback | `npm run build` then `npm run test:e2e:rollback` |
| Reputation/corpus data | `npm run check:topsites`, `npm run build:bloom:test`, `npm run check:bloom-size` |
| Performance-sensitive code | `npm run build` then `npm run check:perf-budget` |
| Version or manifest bump | `npm run verify:versions` |
| Package/release code | `npm run package:ext` |

`.github/workflows/ci.yml` runs product `build-and-unit` and `e2e` jobs, plus a
tag-only release job. Every Playwright lane needs a build first; tests skip when
`extension/dist/` is absent. The default Playwright projects currently select
smoke and regression coverage; issue #488 owns the dormant `@phase2` selector.

## Browser-surface release check

Human Gate-3 applies only when a change alters shipped browser behavior:
MAIN-world interception, credential submits, service-worker navigation,
MutationObserver detection, or visible UI. Test/Gym-only, documentation, and
dependency-only changes do not require it. The current human queue and guides
are in `ACTION_ITEMS.md` and `docs/agentic/GATE3_GUIDES.md`.

## Optional workflow aids

The remaining `.claude/skills/` and `.agents/skills/` files are optional domain
references. They are not hooks, gates, or a parity contract, and the two
runtimes may evolve independently. Product commands and observed behavior are
authoritative when a workflow note is stale.
