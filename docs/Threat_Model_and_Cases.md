# Threat Model and Cases

## Primary threats
- New tab/window via JS: window.open in a click handler (user activation abuse).
- New tab via default link behavior: <a target=_blank>.
- Invisible overlay link: hidden or fullscreen anchor intercepts clicks.
- Script-triggered fake click: element.click() or dispatched events.
- Same-tab forced navigation: location.assign, location.replace, location.href, form submit.
- Server-side or meta refresh redirects (JS-level cannot always stop).
- Rapid multi-popups: multiple window.open calls per gesture.
- Cross-origin iframes: limited injection coverage and popup abuse.

## Hard cases and intended handling
- Overlay hijack: block the overlay click, reroute to the intended underlying element, keep token gating active.
- Optional improvement: temporarily set pointer-events: none on suspect overlays during hit-testing (after capture) to reveal underlying intent.
- Popunder focus tricks: block window.open unless a trusted token exists; offer allow-once UI.
- Rapid multi-popups: invalidate token after first allowed open and auto-block extra attempts.
- Legit OAuth/payment popups: lower risk when the clicked element is visible and clearly intentful; allowlist and prompt for safety.
- Same-tab redirects: patch what is feasible in page world and use DNR as a backstop for known bad destinations.
- Cross-origin frames: use a background fallback (webNavigation) to detect new tabs without a valid token.

## Assumptions and non-goals
- Not all same-tab redirects are preventable in MV3.
- This is not a general ad blocker.
- No remote classification; privacy-first by design.
