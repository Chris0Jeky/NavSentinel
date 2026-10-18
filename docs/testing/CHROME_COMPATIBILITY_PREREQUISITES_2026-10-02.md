# Chrome compatibility prerequisites — 2026-10-02

Source snapshot: `1dc820acd27d20384c56aa115a913e8adf2a9a14`.
Scope: default release-eligible `interaction-only` artifact, M1 package truth
and the minimum/current browser matrix required by [#458](https://github.com/Chris0Jeky/NavSentinel/issues/458).

**The minimum supported Chrome version is still unverified.** Neither the
source manifest nor this inventory declares one. The
[submission checklist](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/docs/cws-listing/REVIEW_CHECKLIST.md#L90)
requires deriving and testing it before setting `minimum_chrome_version`.
An API introduction date or successful current-Chrome run alone does not satisfy
that requirement.

## Measured build configuration

The lockfile-matched installation contains Vite **8.2.2** and CRX plugin
**2.7.1**. Resolving `vite.config.ts` for a build, without emitting an artifact,
produced this value for both `build.target` and `build.cssTarget`:

```json
["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"]
```

The source [Vite configuration](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/vite.config.ts#L57)
does not explicitly set either target. This is the resolved installed default,
not a promise that every runtime API has been polyfilled. The
[TypeScript configuration](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/tsconfig.json#L3)
uses ES2022/DOM types and ESNext modules; those type settings do not establish
browser compatibility either.

Chrome 111 is therefore a candidate to investigate, rather than an accepted
support floor. Dependency or profile changes require resolving the build again.

## Required features and guarded fallbacks

| Surface | Current use | Constraint and proof still needed |
| --- | --- | --- |
| Static MAIN-world content script | [Manifest](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/manifest.json#L44) loads the guard at document start in every matching frame. | No alternate injection path. Chrome documents [ExecutionWorld](https://developer.chrome.com/docs/extensions/reference/api/extensionTypes#type-ExecutionWorld) from 111 and describes the manifest [world key](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts). Verify actual injection and bridge readiness on the candidate. |
| Session storage | [Hydration and persistence](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/shared/session_state.ts#L292) preserve worker state. | Chrome documents [storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session) from 102. Read failure intentionally degrades that worker to memory-only; this is not proof of equivalent protection on a browser without the API. |
| Exact document context | The broker [rejects incomplete/inactive frame context](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/sw/pending_decision_handlers.ts#L160) and [targets delivery by documentId/frameId](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/sw/pending_decision_handlers.ts#L553). | Chrome documents [DocumentLifecycle](https://developer.chrome.com/docs/extensions/reference/api/extensionTypes#type-DocumentLifecycle) and [tabs.sendMessage documentId](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage) from 106. Do not replace missing document identity with frame-only authorization. |
| Child creation correlation | [Browser-created target handler](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/sw/sw.ts#L1360) complements tabs.onCreated. | Verify actual event delivery and later opener-write correlation; a type declaration or DOM opener alone does not prove it. |
| structuredClone | [Settings loading](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/shared/storage_impl.ts#L330) and [external-settings reconciliation](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/options/options_model.ts#L34) call it directly. | Unpolyfilled runtime API, with no feature check at these calls. Exercise both initial settings and conflict reconciliation on the candidate. |
| Object.hasOwn | [Domain lookup](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/shared/domain.ts#L132), profile factors, settings and explanation lookups use it. | Unpolyfilled runtime API. Exercise these consumers; a search of only the guard/broker files would miss it. |
| Lazy content-script modules | [Pending-navigation prompt import](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/content/capture_isolated.ts#L2043) loads a bundled module; MV3 worker modules use static imports. | A rejected content import has a local fallback. That catch cannot recover if the importing content entry itself fails to parse. Verify both worker startup and content module loading. |
| Popover/top-layer toast | [Feature check and fallback](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/content/ui_toast.ts#L144) retain a z-index host when showPopover is absent or throws. | A guarded API does not establish equivalent occlusion or input behavior. Exercise fallback visibility, native clicks and keyboard actions instead of treating current top-layer tests as older-browser proof. |
| Closed shadow roots | [Optional chrome.dom lookup](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/content/capture_isolated.ts#L1398) returns null when unavailable or throwing. | Record this observability limit separately from extension startup support; it is not a polyfill. |

The default [profile](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/config/release-profiles.json#L3)
disables reputation and JS-behavior instrumentation. Its
[reputation implementation](https://github.com/Chris0Jeky/NavSentinel/blob/1dc820acd27d20384c56aa115a913e8adf2a9a14/extension/src/shared/reputation_runtime.disabled.ts#L5)
is a no-op; seeing a call to its exported loader does not establish an active
reputation dependency. Planned side-panel/ML APIs and test-only DevTools
extension loading do not define this production floor.

## Remaining compatibility evidence

Use one exact interaction-only artifact on the candidate browser and current
branded stable Chrome. Record executable/version, profile, artifact hashes,
MAIN/isolated readiness, worker startup/recycle, document-bound action delivery,
settings reconciliation and fallback UI behavior. Include fresh-install and
normal-site behavior plus the established regression, acceptance and rollback
lanes; a descriptor-only probe cannot qualify the whole product.

For #458 specifically, record own Location method descriptors and real
assign/replace navigation, worker observation and any rollback separately.
Browser-owned methods reaching a server before rollback must never be reported
as pre-call interception or pre-harm protection.

Chrome's [storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage#storage-areas)
also distinguishes older quotas: session storage is 1 MB through Chrome 111,
and local storage was 5 MB through Chrome 113. Include storage-capacity and
honest failure behavior in the candidate matrix; current-browser quotas cannot
be silently assumed.

This inventory ran no older-browser compatibility matrix and changes no
manifest, support policy or runtime behavior. #458 remains open. Privacy,
consent and owner gates remain separate; `ACTION_ITEMS.md`/AI-19 is the human
queue. Automated profiles are not a human Gate-3 result.
