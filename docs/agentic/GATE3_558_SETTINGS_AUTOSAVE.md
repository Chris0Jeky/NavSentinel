# AI-43 subprocedure — Settings autosave and conflict choices (#558)

Post-merge branded-Chrome subprocedure retained by the consolidated AI-47
check in `ACTION_ITEMS.md`. Under D-2026-09-12-P this is no longer a pre-merge
human gate for merged #643 and #655. Only Chris may perform and record this
sub-result under AI-47; an agent may only preserve Chris's explicit observation.
#658 remains **OPEN — not run** until it actually merges, so this guide does not
assert owner acceptance for #658 or any other candidate.

1. Build the then-current `main` head selected for AI-47 with `npm run build`.
   In a disposable Chrome profile, the owner loads/reloads that checkout's
   `extension/dist` from `chrome://extensions`. Record the 40-character head,
   Chrome version, and reload result. Expected build markers: `capture=1`,
   `bridge=1`, and the `ui-guard` revision emitted by that exact build. Do not
   compare against a hardcoded historical guard revision.
2. Open Options. **Auto-save changes** starts enabled in a fresh profile.
   Change navigation with the arrow keys and toggle overlay auto-dismiss. Reload
   Options and verify those choices persisted without pressing Save.
3. Cleanup status is **Disabled** when auto-dismiss is off; when enabled it is
   green **Active** in Smart/Strict and red **Paused · Navigation Off** in Off.
   This describes the saved configuration, not a guarantee about a particular
   page's overlays. Confirm matching text in the popup.
4. Clear a numeric field or enter a value outside its displayed limits. Save is
   unavailable and the persistent state asks for a valid number. Change another
   setting in a second Options window; the incomplete input must remain intact.
   Enter a valid number and check that both windows converge.
5. Disable Auto-save, reload, and verify it stayed disabled. Edit a setting and
   navigate between Options panes: **Unsaved changes**, Save, and Discard remain
   available. Discard restores saved values; Save persists only edited fields.
6. With auto-save disabled, set Navigation Strict in window A without saving.
   Set Navigation Off and Save in window B (start both from Smart). Window A
   shows a conflict and keeps its draft. **Use external values** adopts Off;
   unrelated unsaved edits remain. Repeat, choosing **Keep my edits**, then Save:
   the explicit local choice wins and both windows show it. The #658 same-field
   save from two windows started at one baseline remains **OPEN — not run** until
   #658 merges; do not treat its branch behavior as a current-`main` observation.
7. Keep an unrelated Options field dirty, change popup Navigation/Credential and
   overlay controls, then Save Options. Popup choices must survive. Check both
   mouse and keyboard operation and readable status at a narrow window width.
8. Export with auto-save disabled, enable it, then import the backup. Auto-save
   returns to disabled. Import intentionally replaces the complete draft.
   Also import a backup with `settings.logLimit` set to `55`. The Log ring
   buffer accepts it without a validation error; change Navigation and save,
   then export again and confirm `logLimit` remains `55` (#655).

Automated disposable-Chromium tests cover these storage/UI paths; they do not
replace Chris's unpacked Chrome reload and visual acceptance. Only Chris may
record a #643/#655 pass or the exact failing step as the former-AI-43 sub-result
under AI-47. #658 remains **OPEN — not run** until it merges and Chris observes
its distinct same-field behavior. No telemetry, permissions, or runtime guard
changes are part of this slice.
