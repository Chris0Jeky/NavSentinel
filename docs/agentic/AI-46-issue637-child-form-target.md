# Retained AI-46 — issue #637 child-form target Gate-3

> **POST-MERGE QUEUE since 2026-09-12 — read before step 1.** Under
> [`D-2026-09-12-P`](DECISIONS.md), PR #649 may merge after its non-human gates
> without completing this branded-Chrome check first. If it merges, preserve
> every step below as the former AI-46 sub-result inside consolidated AI-47 on
> current `main`; this guide is neither a renewed pre-merge gate nor evidence
> that the human check passed.

Use this guide only after the pull request fixing issue #637 has merged. The
change alters shipped MAIN-world form interception, so only Chris can record
the branded-Chrome result.

1. Record the then-current 40-character `main` SHA containing PR #649 and
   require the reconciled PR head's exact-head CI to have been green.
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

On a pass, record:

`AI-47 child-form sub-result (former AI-46) passed on main at <40-character SHA>; Chrome <version>`

On a mismatch, leave consolidated AI-47 open and report the failing step, URL
class (do not include credentials or private query values), expected behavior,
observed behavior, Chrome version, and exact `main` SHA.
