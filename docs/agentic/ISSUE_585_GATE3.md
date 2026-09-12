# Issue #585 popup association Gate-3

This issue changes the shipped popup `Current page` gauge association. Under
the one-time decision `D-2026-09-12-P`, this procedure is no longer a pre-merge
gate for PR #644; it remains the exact event-association subprocedure required
by the consolidated post-merge `AI-47` check on current `main`. The automated
storage and popup-model tests prove the sanitization and selection rules; only
Chris can record the browser result.

## Procedure

1. Confirm the built `extension/dist` points at the exact current `main` head
   being tested. Build the interaction-only profile and load that `dist`
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
5. For the #646 follow-up, repeat with accepted noncanonical IP literals such
   as `127.000.000.001` and `[2001:0DB8:0:0:0:0:0:1]`. Confirm that the event
   log stores the browser-compatible hostnames (`127.0.0.1` and
   `2001:db8::1`) and that the popup association follows the browser's
   `location.hostname` where the target address is available.

Record this as the former AI-44 sub-result under AI-47, including the exact
40-character `main` SHA and Chrome version, or record the exact failing step
and observed result. Do not treat the automated tests or a partial extension
reload as a human Gate-3 pass.
