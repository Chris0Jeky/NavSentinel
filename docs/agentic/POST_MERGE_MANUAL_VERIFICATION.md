# Post-Merge Manual Verification — Deferred Gate 3 (2026-06-05 batch)

**Why this file exists:** On 2026-06-05 the maintainer (Chris) explicitly **waived Gate 3 (manual Chrome test)** for the 11 D-series discovery PRs and merged them on the strength of fresh-green CI (Build/Unit + E2E) + two independent adversarial review rounds with every finding fixed. See `ACTION_ITEMS.md` (Completed log AI-1/AI-2) and the merge-commit bodies.

The waiver did **not** delete the manual checks — it **deferred** them. This file is the regression watchlist: the specific real-browser behaviors that automated tests cannot fully prove. The accepted risk is therefore *time/difficulty when debugging* (you have a precise list of what to check first), **not** silent regressions.

**How to use:** When loading the extension in Chrome (next time you build, or if anything misbehaves), run these. Record results with `gh pr comment <#> --body "Post-merge manual check: PASS/FAIL — notes"` and check items off below. If something fails, open an issue and seed a fix — do not let it sit.

## Setup (once)
1. `git checkout main && npm ci && npm run build` (outputs to `extension/dist`).
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist`.
3. Second terminal: `npm run gym:serve` (fixtures at `http://localhost:5173`).
4. Keep the **service-worker console** (chrome://extensions → "service worker") and a **page console** open to catch errors.

## Per-PR watchlist

- [ ] **#183 D-FOCUS — credential-modal focus trap** (most browser-visible). Open `level11-credential-guard.html`, type a password, Submit → "Credential submit blocked" modal appears. Verify: Tab/Shift+Tab cycles only modal buttons; clicking the page behind snaps focus back; `document.querySelector('#submitBtn').focus()` in console bounces focus back into the modal; Esc/cancel dismisses and returns focus sensibly.
- [ ] **#182 D-STORE — prompt outcomes persist.** Trigger several credential prompts; choose trust/block rapidly across reloads and multiple tabs/frames. Choices persist; popup/options reflect them; no lost outcomes.
- [ ] **#180 D-PROF — no domain-profile errors under repeated navigation.** Browse risky/benign fixtures repeatedly; risk state stays consistent; no SW-console errors.
- [ ] **#185 D-BRIDGE — regression smoke.** Browse nav-block / dblclick / clipboard-ClickFix / pushstate fixtures; guard fires normally; **no** `Cannot assign to read only property 'submit'` (the form-submit patch-order bug, fixed here); no SW/page console errors.
- [ ] **#187 D-SWRATE — viewport-capture rate limit survives SW restart.** Exercise capture, let the SW idle/restart (or toggle the extension), confirm rate-limit still enforced; no SW-console errors.
- [ ] **#189 D-ANOM — anomaly scoring sane.** With built-up history: burst to a *rare* category (crypto/wallet fixtures) → anomaly raises risk; burst to a *frequent* category → no false elevation. No SW errors.
- [ ] **#190 D-IFRAME — iframe flags w/o false positives.** Benign page: legit iframes (recaptcha/analytics) NOT flagged, page works. Inject `document.body.appendChild(Object.assign(document.createElement('iframe'),{srcdoc:'<form><input type=password></form>'}))` → suspicious-iframe signal registers. No errors.
- [ ] **#191 D-ONCREATE — DoubleClickjacking survives SW restart.** Exercise dblclick gym fixtures (child window navigating the opener); dblclick alert still fires after an SW restart; no SW errors.
- [ ] **#193 D-REDOS — content fingerprinting unchanged.** Browse phishing-kit fixtures (hidden exfil form/iframe pages); kit detection still fires; no errors. (Regex-internals hardening, zero intended detection change.)
- [ ] **#194 D-OPTRACE — options Save reentrancy.** On the options page, click Save rapidly / double-click; settings persist correctly with no duplicate-write corruption or stuck UI.
- [ ] **#195 D-SRIHIDE — SRI hidden-password handling.** On pages with inline-hidden password fields, the credential gate behaves as designed (mirrors content_analyzer); no false credential prompts on hidden fields.
- [ ] **#202 (#188) — prompt-outcome clear/import failure surfaces (not phantom success).** Hard to trigger (the error path needs the SW persistently unreachable across ~4 retries, ~600ms), so it has unit coverage at the storage + classify layers but no automated full-UI test. Manual repro: open the options page, then in `chrome://extensions` **terminate** the extension's service worker (or reload the extension) and *immediately* click **Clear stats** (and separately run an **Import**) so the delegated write can't reach a live SW. Expect an **error** status — "Couldn't clear stats — try again." / "Imported, but prompt history wasn't updated — try again." — NOT a success message; for the import the non-prompt-outcome sections still apply and the UI refreshes. With the SW alive, clear/import still succeed and persist.

## Sign-off
When all boxes are checked PASS, note it here with the date, and tell the agent so it can move this to a "done" state and update `ACTION_ITEMS.md`.
