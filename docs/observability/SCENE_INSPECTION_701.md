# Measured scene inspection (#701)

This slice adds scene inspection above #704's recorder. It does not execute archived
pages, load images/remote assets, or claim that a scene illustration is a recording.
The same projected events drive the human viewer and headless JSON.

## Use the view

```bash
# Explicitly authored teaching data, never a protection receipt:
node experiments/evidence-observatory/cli.mjs demo --out test-results/new-scene-demo
# Actual full-trace.json files from a completed recorded campaign:
node experiments/evidence-observatory/cli.mjs inspect --input PATH_TO_SELECTED_TRACES --out test-results/new-scene-inspection
```

Open the generated `index.html`. Select a baseline or protected case and step to a
`scene.sample` event. The measured diagram shows the containing frame, legitimate
controls and intercepting layers. Text rows show visible/hidden/absent status,
frame/document identity and declared versus effective destination category.

Step beyond the sample: its capture time and age remain visible. The scene does not
silently become a fresh measurement. Before the first sample the view explicitly
has no geometry. A detached frame or new document invalidates the prior scene until
a new sample exists. No interpolation fills gaps and no future sample leaks backward.
Click the sample's event reference to inspect its precise structured metadata.

The receiver inbox contains only receipts at or before the selected event, with
links to their event IDs, run IDs and one-use target IDs. No arrivals so far is a
local observation, not an assertion that the attack was prevented. Final assessment
still requires the complete comparison, receiver health and observation window.

## Implementation seams

- `scene-view.mjs`: pure `selectScene(events, cursor)` chooses the latest prior
  measurement and checks frame/document invalidation. Returns copied data.
- `render.mjs`: embeds the pure selector with the existing script hash, creates SVG
  using DOM methods and fixed numeric attributes, and renders labels through text
  nodes. Imported SVG, HTML, hyperlinks and scripts are never used.
- `scene-demo.mjs`: extends the existing authored example with labelled v2 geometry.
  It stays `mode: demo` and `rawVerified: false` regardless of illustrative outcomes.
- `tests/scene-view.test.mjs`: future-sample exclusion, sample age, document and frame
  changes, unknown clocks, copy isolation, rendering contracts and demo non-promotion.
- `smoke-browser.mjs`: actual viewer interactions with scene stepping, visible versus
  hidden layers, keyboard controls, local download, hostile text and narrow layouts.

The diagram uses the captured viewport coordinate system. It is a schematic rendering
of measurements, not a screenshot, original page artwork, continuous video, or proof
that an element was visible at every instant between samples. The diagram labels and
text remain useful without color. It has no automatic playback or motion dependency.

## Current scenario contract and realism ceiling

Canonical scenario remains `NS-ADV-UI-004` in the existing security programme; this
view does not add a second scenario registry. Its bounded claim is wrong-target
navigation from a synthetic nested overlay. The legitimate goal is playback-control
activation; the consequence is acceptance by an inert typed loopback HTTP receiver.
The stable and reinsertion variants vary layer lifecycle, not every attack mechanism.

The first recorder exposes full/minimal detailed-instrumentation pairs and retains
all four arms independently. Neither variant is held out: both are development
fixtures and are labelled as such. No randomized seed population, blinded variant
suite, real credential transmission or OS consequence is claimed. A clipboard warning
and post-commit rollback need different scene/consequence contracts; they cannot be
painted as prevented by reusing this diagram.

Next acceptance work under #701: held-out timing/topology variants, keyboard/modifier
journeys, child-form before/after intent mutation, dynamic target reassociation,
independent browser sampling comparisons, plus uncertainty/invalid-run denominators.
Use #698 after its own runtime changes stabilize. Keep trace/video attachments local
and synthetic; inspect replay is never an implicit command to rerun a page.

## Everyday browsing boundary (#702)

This UI is not a browsing recorder. Geometry, opaque identifiers and test-runner
metadata are intended for synthetic fixtures and are not a universal anonymizer.
#702 must start from reviewed minimized events under #455's consent boundary, reuse
#591's feedback/export model, and leave source observations immutable. See
`LIVE_EPISODE_INTEGRATION_702.md` for the next implementation seams. No live subscription,
permission, storage listener, policy feedback, automatic report or upload is added here.
