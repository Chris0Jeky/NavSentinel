# NavSentinel UI Redesign — Orchestration Plan

*Created 2026-05-16. Single source of truth for the complete UI redesign.*

---

## Overview

Complete visual redesign of all NavSentinel UI surfaces based on the design system in `RESOURCES/redesign/`. The redesign introduces a new brand identity (brass/amber/jade palette, Geist + Instrument Serif typography, aperture/radar logo mark) and rewrites every user-facing surface.

## Design Decision Record

| # | Decision | Rationale |
|---|---|---|
| RD-01 | **Use "Modern" variant** for popup (PopupModern) | Cleaner visual hierarchy, ShieldArc gauge is more scannable, better information density without terminal gimmicks |
| RD-02 | **Use "Modern SOC" variant** for options (OptionsModern) | Grafana-inspired dashboard with proper charts, sidebar nav, and data visualization. More accessible to non-technical users |
| RD-03 | **Use "Modern" variant** for landing (LandingModern) | Dramatic hero, chapter-based narrative, architecture diagram, animated kill-chain. More engaging than the terminal/README style |
| RD-04 | **Use LogoSentinel** (aperture/radar mark) as primary | Animated, distinctive, scales well from 16px to 128px. Brass instrument aesthetic aligned with palette |
| RD-05 | **New palette replaces existing blue/cyan** | Brass #f5a623, Jade #7ab787, Ember #ed7a31, Terracotta #d04531, Gold #e4c544. Deep ink backgrounds #08070a/#030206 |
| RD-06 | **Typography: Geist (sans) + Geist Mono + Instrument Serif** | Modern, readable, distinctive. Serif for display headlines gives editorial feel without being corporate |
| RD-07 | **Landing page as GitHub Pages** | Separate from extension build. Static HTML/CSS/JS, deployable via gh-pages branch |
| RD-08 | **Store assets generated from redesigned extension** | Screenshots taken from running redesigned extension, not mocked |

## Phase Breakdown

### Phase R1: Design Tokens (Foundation)
**Branch:** `feat/redesign-tokens`
**Effort:** S (< 4h)
**Deliverable:** `extension/src/shared/design_tokens.css`

- Port CSS custom properties from `RESOURCES/redesign/styles/tokens.css`
- Adapt for extension context (no external font imports in content scripts; bundle fonts or use system stack)
- Add utility classes (ns-root, ns-mono, ns-serif, ns-uc, etc.)
- Add animation keyframes
- Wire into Vite build (imported by popup.css, options.css, modal, toast)
- **Verification:** `npm run build` succeeds, tokens available in popup/options

### Phase R2: Icon System & Logo
**Branch:** `feat/redesign-icons`
**Effort:** S-M
**Deliverable:** Extension icon PNGs (16/32/48/128) + inline SVG icon utility

- Export LogoSentinel mark at required sizes as static PNGs for manifest
- Create `extension/src/shared/icons.ts` with SVG path data for all UI icons
- Create icon rendering helper (returns SVG string for insertion)
- Update `manifest.json` icon paths
- **Verification:** Extension loads with new icon in toolbar, icon renders at all sizes

### Phase R3: Popup Redesign
**Branch:** `feat/redesign-popup`
**Effort:** M-L
**Deliverable:** Rewritten popup.html, popup.css, popup.ts

- Implement PopupModern layout: header with logo + hostname + trust dot
- ShieldArc SVG gauge for page risk
- Segmented mode controls (Nav/Cred) in cards
- Signal chips display
- Activity feed with event cards
- Trust/Untrust button
- Dashboard link
- Footer "Everything stays local"
- All existing functionality preserved (mode switching, trust toggle, event display)
- **Verification:** Manual test all interactions, E2E popup tests pass

### Phase R4: Options Page Redesign
**Branch:** `feat/redesign-options`
**Effort:** L
**Deliverable:** Rewritten options.html, options.css, options.ts

- Sidebar navigation (Protection, Analytics, Event Log, Trust, Import/Export)
- Analytics panel: stat cards, donut chart, histogram, sparklines, signal frequency bars
- Protection settings: cards with mode selectors, toggles, threshold indicators
- Event log: filterable, expandable entries, export/import/clear
- Trust management: allowlist table, trusted domains list
- Import/Export panel
- All existing functionality preserved
- **Verification:** Manual test all panels, E2E options tests pass

### Phase R5: Credential Modal & Toast
**Branch:** `feat/redesign-modal-toast`
**Effort:** M
**Deliverable:** Updated credential_modal.ts, ui_toast.ts

- Credential modal: dark card, risk icon, key-value grid, signal list, action buttons (cancel/proceed/trust)
- Toast: dark semi-transparent, icon + message + score badge, auto-dismiss
- Match new token palette and typography
- **Verification:** Trigger credential warning on test page, verify modal renders correctly

### Phase R6: Landing Page
**Branch:** `feat/redesign-landing`
**Effort:** L
**Deliverable:** `landing/` directory with static site

- Full LandingModern implementation as standalone HTML/CSS/JS
- Hero section with animated kill-chain visualization
- All sections: attacks, architecture, scoring, comparison, privacy, gym, brands, roadmap
- Responsive (desktop-first, mobile-adequate)
- No build tool required (vanilla or minimal bundler)
- **Verification:** Renders correctly in Chrome, mobile viewport adequate

### Phase R7: Chrome Web Store Assets
**Branch:** `feat/redesign-store`
**Effort:** M
**Deliverable:** Store screenshots, promo tile, updated listing copy

- 5 screenshots (1280x800): popup, credential modal, dashboard, toast, scoring
- Promotional tile (1400x560)
- Updated store description per design brief
- **Verification:** Assets meet CWS size requirements

### Phase R8: Test Updates
**Branch:** `feat/redesign-tests`
**Effort:** M
**Deliverable:** All tests green with new UI

- Update E2E selectors for new popup DOM structure
- Update E2E selectors for new options DOM structure
- Add visual regression baseline screenshots (if infra supports)
- Ensure unit tests still pass (non-UI tests unaffected)
- **Verification:** `npm run test` and `npm run test:e2e` both pass

### Phase R9: Integration & QA
**Branch:** (done on main after all merges)
**Effort:** M
**Deliverable:** Signed-off release candidate

- Full manual QA checklist (see below)
- Performance audit (popup render time, options page load)
- Accessibility audit (keyboard nav, screen reader, contrast)
- Cross-check: all gym fixtures still trigger/block correctly
- **Verification:** All gates from PR Merge Protocol pass

---

## Manual QA Checklist

- [ ] Extension loads without errors in chrome://extensions
- [ ] New icon visible in toolbar at correct sizes
- [ ] Popup opens, shows current site hostname
- [ ] Popup trust/untrust toggles correctly
- [ ] Popup mode selectors switch modes (verify via options page)
- [ ] Popup shows recent events
- [ ] Popup "Open dashboard" opens options page
- [ ] Options page loads, sidebar navigation works
- [ ] Options: Protection settings save correctly
- [ ] Options: Analytics shows correct data from storage
- [ ] Options: Event log displays, filters work
- [ ] Options: Trust management add/remove works
- [ ] Options: Import/Export round-trips correctly
- [ ] Credential modal appears on phishing test page
- [ ] Credential modal Cancel/Proceed/Trust buttons work
- [ ] Toast appears when click is blocked
- [ ] Toast auto-dismisses
- [ ] Gym Level 1-12: extension detects and blocks
- [ ] No console errors during normal browsing
- [ ] Performance: popup opens in < 200ms
- [ ] Performance: options page interactive in < 500ms

---

## PR Workflow (Per Phase)

1. Create feature branch from `main`
2. Implement the phase deliverable
3. Self-review: typecheck, lint, build, unit tests
4. Push branch, create PR
5. **Review Round 1**: Structured adversarial review (correctness, security, style, tests, design adherence)
6. Fix all findings from Round 1
7. Check and address all bot comments
8. **Review Round 2**: Fresh adversarial review (break it: edge cases, race conditions, visual regressions)
9. Fix all findings from Round 2
10. Verify: CI green, all tests pass, manual testing done
11. Confirm: zero tech debt, docs synced
12. Merge to main

---

## Dependency Graph

```
R1 (tokens) ──┬──► R2 (icons) ──┬──► R3 (popup) ──────┐
              │                  ├──► R4 (options) ─────├──► R9 (store assets)
              │                  ├──► R5 (modal/toast) ─┤
              │                  └──► R6 (landing) ─────┤
              │                                         └──► R10 (tests) ──► R11 (QA)
              └────────────────────────────────────────────────────────────────────────
```

## Design Source Files

All design reference material lives in `RESOURCES/redesign/`:

| File | Purpose |
|------|---------|
| `uploads/Design_Brief_for_Claude_Design.md` | Complete product design spec |
| `styles/tokens.css` | CSS custom properties, typography, animations |
| `components/ns-shared.jsx` | Logos, icons, charts, shared primitives |
| `components/popup.jsx` | Popup variants (use PopupModern) |
| `components/options.jsx` | Options variants (use OptionsModern) |
| `components/landing.jsx` | Landing page variants (use LandingModern) |
| `components/store.jsx` | Store listing & promo assets |
| `design-canvas.jsx` | Canvas wrapper (dev tool only, not shipped) |
| `NavSentinel.html` | Preview harness |

## Success Criteria

The redesign is complete when:
1. All 9 phases merged to main via the PR Merge Protocol
2. Extension loads and all functionality works with new UI
3. All tests pass (unit + E2E)
4. Manual QA checklist fully green
5. Landing page deployed
6. Store assets ready for upload
7. Zero tech debt from the redesign work
