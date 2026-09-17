import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../model.mjs';
import { sceneDemonstration } from '../scene-demo.mjs';
import { selectScene } from '../scene-view.mjs';

const scene = {
  width: 1000,
  height: 700,
  boxes: [{
    id: 'layer', frameId: 'child-frame', documentId: 'child-document', parentFrameId: 'top-frame',
    kind: 'attack', state: 'visible', x: 10, y: 10, width: 100, height: 200,
    declaredTarget: 'harm-receiver', effectiveTarget: 'harm-receiver', targetScope: 'new-context',
  }],
};
const events = [
  { id: 'start', kind: 'run.start', elapsedMs: 0, data: {} },
  { id: 'sample', kind: 'scene.sample', elapsedMs: 20, data: { scene } },
  { id: 'block', kind: 'decision.block', elapsedMs: 40, data: {} },
];

test('detaching an ancestor invalidates sampled descendant geometry', () => {
  const input = [...events, {
    id: 'top-detached', kind: 'frame.detached', elapsedMs: 60,
    data: { context: { frameId: 'top-frame', documentId: 'top-document', parentFrameId: null } },
  }];

  assert.equal(selectScene(input, 3).invalidated, true);
});

test('navigating an ancestor invalidates sampled descendant geometry', () => {
  const input = [...events, {
    id: 'top-navigated', kind: 'navigation.committed', elapsedMs: 60,
    data: { context: { frameId: 'top-frame', documentId: 'top-document-2', parentFrameId: null } },
  }];

  assert.equal(selectScene(input, 3).invalidated, true);
});

test('later frame identity reuse cannot resurrect invalidated descendant geometry', () => {
  const input = [...events,
    {
      id: 'top-navigated', kind: 'navigation.committed', elapsedMs: 60,
      data: { context: { frameId: 'top-frame', documentId: 'top-document-2', parentFrameId: null } },
    },
    {
      id: 'child-reused', kind: 'frame.attached', elapsedMs: 80,
      data: { context: { frameId: 'child-frame', documentId: 'new-child-document', parentFrameId: 'other-top' } },
    },
    { id: 'end', kind: 'observation.end', elapsedMs: 100, data: {} },
  ];

  assert.equal(selectScene(input, 5).invalidated, true);
});

test('an unrelated frame lifecycle event leaves sampled geometry current', () => {
  const input = [...events, {
    id: 'other-detached', kind: 'frame.detached', elapsedMs: 60,
    data: { context: { frameId: 'other-frame', documentId: 'other-document', parentFrameId: null } },
  }];

  assert.equal(selectScene(input, 3).invalidated, false);
});

test('the teaching baseline rotates document identity and leaves old geometry invalid', () => {
  const report = buildReport([JSON.stringify(sceneDemonstration())]);
  const baseline = report.cases.find(item => item.arm === 'baseline');
  assert.ok(baseline);
  const navigationIndex = baseline.events.findIndex(event => event.kind === 'navigation.committed');
  assert.ok(navigationIndex > 0);

  const selected = selectScene(baseline.events, navigationIndex);
  assert.ok(selected);
  const previousDocument = selected.scene.boxes[0].documentId;
  const replacementDocument = baseline.events[navigationIndex].data.context.documentId;

  assert.notEqual(replacementDocument, previousDocument);
  assert.equal(selected.invalidated, true);
  assert.equal(selectScene(baseline.events, baseline.events.length - 1).invalidated, true);
});
