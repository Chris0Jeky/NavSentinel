'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../shared/core.js');
const { CapabilityStore } = require('../daemon/security.cjs');

const keys = ['tab', 'frame', 'document', 'navigation', 'actionId'];
const invalid = [
  ['object', {}],
  ['array', ['shared-identity']],
  ['true', true],
  ['false', false],
  ['NaN', NaN],
  ['positive infinity', Infinity],
  ['negative infinity', -Infinity],
  ['boxed number', new Number(7)],
  ['boxed string', new String('shared-identity')],
  ['bigint', 7n],
  ['symbol', Symbol('shared-identity')],
  ['function', () => 'shared-identity'],
];

function event(key, value) {
  return {
    action: 'navigate',
    source: 'https://source.test/',
    destination: 'https://destination.test/',
    signals: [],
    context: { tab: 'tab-1', frame: 'frame-1', document: 'document-1',
      navigation: 'navigation-1', actionId: 'action-1', [key]: value },
  };
}

function invalidContext(key) {
  return error => error instanceof TypeError && error.message === `Invalid context.${key}`;
}

for (const key of keys) {
  for (const [name, value] of invalid) {
    test(`context.${key} rejects ${name} rather than converting it to an identity`, () => {
      assert.throws(() => Core.normalizeEvent(event(key, value)), invalidContext(key));
    });
  }

  test(`context.${key} never invokes object coercion`, () => {
    let coercions = 0;
    const value = { [Symbol.toPrimitive]() { coercions++; return 'borrowed-identity'; } };
    assert.throws(() => Core.normalizeEvent(event(key, value)), invalidContext(key));
    assert.equal(coercions, 0);
  });

  test(`context.${key} accepts bounded strings and finite numeric identities`, () => {
    for (const value of ['document-2', 'x'.repeat(96), 0, -0, -1, 0.5, Number.MAX_VALUE]) {
      const input = event(key, value);
      assert.equal(Core.normalizeEvent(input).context[key], String(value));
      assert.equal(input.context[key], value, 'normalization must not mutate caller data');
    }
  });

  test(`context.${key} retains string length and control-character bounds`, () => {
    for (const value of ['', 'x'.repeat(97), 'line\nbreak', 'nul\0byte', 'delete\x7f']) {
      assert.throws(() => Core.normalizeEvent(event(key, value)), invalidContext(key));
    }
  });

  test(`context.${key} preserves missing, undefined and null defaults`, () => {
    const fallback = key === 'frame' ? '0' : 'demo';
    const missing = event(key, 'unused');
    delete missing.context[key];
    assert.equal(Core.normalizeEvent(missing).context[key], fallback);
    for (const value of [undefined, null]) {
      assert.equal(Core.normalizeEvent(event(key, value)).context[key], fallback);
    }
  });

  test(`context.${key} remains part of exact-context matching`, () => {
    const first = event(key, 'identity-a');
    assert.equal(Core.sameContext(first, structuredClone(first)), true);
    assert.equal(Core.sameContext(first, event(key, 'identity-b')), false);
  });

  test(`context.${key} cannot mint a capability from an object identity`, () => {
    const store = new CapabilityStore();
    assert.throws(() => store.issue({ event: event(key, {}), caller: 'agent', requestId: 'request-1' }),
      invalidContext(key));
    assert.equal(store.items.size, 0);
  });

  test(`context.${key} cannot spend a string-bound grant by object coercion, and burns the attempt`, () => {
    const store = new CapabilityStore();
    const approved = event(key, '[object Object]');
    const grant = store.issue({ event: approved, caller: 'agent', requestId: 'request-1' });
    assert.throws(() => store.consume({ token: grant.token, event: event(key, {}), caller: 'agent' }),
      invalidContext(key));
    assert.equal(store.items.size, 0);
    assert.throws(() => store.consume({ token: grant.token, event: approved, caller: 'agent' }),
      /Unknown, used or revoked capability/);
  });
}
