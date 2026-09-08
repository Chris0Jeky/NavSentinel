# AI-46 — issue #637 child-form target Gate-3

Use this guide only for the pull request that fixes issue #637. The change
alters shipped MAIN-world form interception, so a maintainer must verify the
exact built head in branded Chrome before merge. Only Chris can record the
Gate-3 result.

1. Confirm the pull request is open, ready for review, and still based on PR
   #636. Record its 40-character head SHA and require exact-head CI to be green.
2. In that exact checkout, run `npm run build`. Record the emitted
   `ui-guard=<revision>` marker and leave `extension/dist` unchanged afterward.
3. Open `chrome://extensions`, enable Developer mode, and load or reload that
   exact `extension/dist`. Confirm Chrome shows no extension error. This reload
   is the human-owned proof that branded Chrome accepted the artifact.
4. Run the focused local regression:
   `$env:CI='1'; npx playwright test tests/e2e/issue593-hidden-media-layer.spec.ts
   --project=regression --workers=1`. Require the `top-form-submit-100` and
   `empty-formaction-submit-100` attack arms to report `BLOCKED_PRE_HARM` with
   zero sink receipts. Require all three of
   `benign-declared-form-submit-100`, `benign-declared-request-submit-100`, and
   `benign-top-form-submit-100` to report `BENIGN_ALLOWED`.
5. In the reloaded branded profile, use an ordinary top-frame GET form and one
   embedded sign-in, checkout, or search form that visibly declares its submit
   control. Confirm the intended destination opens, Back returns normally, and
   NavSentinel shows no false block for either flow.
6. Re-open `chrome://extensions` and confirm there are still no new extension
   errors. Record the Chrome version and the exact head SHA.

On a pass, reply:

`AI-46 done; Gate-3 passed on issue #637 PR #<n> at <40-character SHA>; Chrome <version>`

On a mismatch, leave AI-46 open and report the failing step, URL class (do not
include credentials or private query values), expected behavior, observed
behavior, Chrome version, PR number, and exact head SHA.
