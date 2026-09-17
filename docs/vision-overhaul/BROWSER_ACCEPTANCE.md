# Protection Center browser acceptance (AI-42)

This check covers the new visible extension UI only. The Lab's experimental
extension is a different artifact. It does not substitute for the existing guard.
Under D-2026-09-12-P, this procedure remains required as the #640 sub-result of
the consolidated post-merge AI-47 check; the waiver changes timing, not scope.

1. Build the then-current `main` exact head with `npm ci`, `npm run build`. Record
   `git rev-parse HEAD` and the Chrome version. Use a dedicated testing profile.
2. The owner loads/reloads this checkout's `extension/dist` at
   `chrome://extensions`. Agents must not operate that page or infer acceptance
   from a regular page reload.
3. Open the extension popup, then **Protection Center**. Confirm the page is
   extension-owned, shows retained observations (or a clear empty state), and
   does not describe an empty journal as proof that a site is safe.
4. Exercise the theme choices with keyboard input. Reopen the page and confirm
   the choice persists. Check a narrow window and Windows high contrast or zoom
   if those are part of the owner's normal setup.
5. With recorded events present, filter the journal and inspect an event. Confirm
   readable reasons and source/destination hostnames. Export the evidence file
   and inspect its preview: no URL paths, queries, password/clipboard values,
   arbitrary `extra` fields or bearer tokens should appear.
6. In the served Lab or desktop shell, import that file explicitly. Compare the
   count and event details, add a user correction, export, and clear imported
   history. Confirm original extension history and synthetic Lab history remain
   intact. A correction must never create an Allow/Proceed action.
7. Open existing Options and popup controls. Confirm navigation/credential mode
   and trust settings continue to behave as before.

Record this as the #640/AI-42 sub-result under AI-47, including
acceptance/rejection, exact head, Chrome version, and any failed step.
Automated Chromium and native-shell checks do not close this owner check.
