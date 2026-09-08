# Issue #585 popup association Gate-3

This issue changes the shipped popup `Current page` gauge association, so the
visible popup behavior remains a human-owned Gate-3 check. The automated
storage and popup-model tests prove the sanitization and selection rules; only
Chris can record the browser pass.

## Procedure

1. Confirm the worktree, PR, and built `extension/dist` all point at the exact
   pushed head. Build the interaction-only profile and load that `dist`
   directory in a disposable Chrome profile. Keep established profiles and
   extensions untouched.
2. Start the Gym fixture server and open a fresh HTTP page at
   `http://127.0.0.1:5173/level1-basic-opacity.html`. In Options, import a
   temporary JSON export containing these event rows:

   ```json
   {
     "eventLog": [
       {
         "id": "ai44-valid-page",
         "ts": 1,
         "kind": "nav_click_block",
         "site": "frame.other.test",
         "pageSite": "127.0.0.1",
         "score": 80
       },
       {
         "id": "ai44-empty-page",
         "ts": 2,
         "kind": "nav_click_block",
         "site": "127.0.0.1",
         "pageSite": "",
         "score": 70
       },
       {
         "id": "ai44-url-page",
         "ts": 3,
         "kind": "nav_click_block",
         "site": "127.0.0.1",
         "pageSite": "https://other.test/account?token=secret#fragment",
         "score": 60
       }
     ]
   }
   ```

   The import must complete without an error. In the Options event log, the
   full URL must not appear as a `pageSite` value; its path, query, and
   fragment must not be retained.
3. Open the NavSentinel popup on the loopback page. The `Current page` gauge
   must show the imported loopback risk (60), proving that the malformed
   `pageSite` fell back to the valid legacy `site`. The valid cross-host row
   must associate with loopback when it is the newest applicable row; repeat
   with that row last if needed to make the visible association explicit.
4. Repeat the import with valid ordinary, IPv4, and IPv6 `pageSite` values as
   needed for the target Chrome environment. Confirm no popup, page, or
   service-worker console errors, then close the disposable profile and stop
   the fixture server.

Record either `AI-44 done; Gate-3 passed on main at <40-character SHA>` or the
exact failing step and observed result. Do not treat the automated tests or a
partial extension reload as a human Gate-3 pass.
