'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../src/shared/constants.js');
const S = require('../../src/content/scoring.js');
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('a single family scores its own weight', () => {
  const r = S.score([{ family: 'label', weight: 0.85 }]);
  assert.ok(near(r.confidence, 0.85));
  assert.deepEqual(r.families, ['label']);
});

test('duplicate signals within a family do not inflate confidence', () => {
  const r = S.score([{ family: 'link', weight: 0.9 }, { family: 'link', weight: 0.9 }, { family: 'link', weight: 0.9 }]);
  assert.ok(near(r.confidence, 0.9));
});

test('independent families reinforce each other (noisy-OR)', () => {
  const r = S.score([{ family: 'label', weight: 0.85 }, { family: 'class', weight: 0.9 }]);
  assert.ok(near(r.confidence, 1 - 0.15 * 0.1));
  assert.equal(r.families.length, 2);
});

test('empty evidence scores zero and never passes', () => {
  const r = S.score([]);
  assert.equal(r.confidence, 0);
  for (const m of ['strict', 'balanced', 'aggressive']) assert.equal(S.meetsMode(r, m), false);
});

test('mode thresholds', () => {
  const label = S.score([{ family: 'label', weight: 0.85 }]);
  const weakAd = S.score([{ family: 'label', weight: 0.55 }]);
  const widgetOnly = S.score([{ family: 'widget', weight: 0.5 }]);
  const two = S.score([{ family: 'label', weight: 0.85 }, { family: 'link', weight: 0.9 }]);
  assert.equal(S.meetsMode(label, 'balanced'), true);
  assert.equal(S.meetsMode(label, 'strict'), false, 'strict needs two families');
  assert.equal(S.meetsMode(two, 'strict'), true);
  assert.equal(S.meetsMode(weakAd, 'balanced'), false);
  assert.equal(S.meetsMode(weakAd, 'aggressive'), true);
  assert.equal(S.meetsMode(widgetOnly, 'balanced'), false);
  assert.equal(S.meetsMode(widgetOnly, 'aggressive'), true);
});

test('unknown mode falls back to balanced', () => {
  assert.equal(S.meetsMode(S.score([{ family: 'label', weight: 0.85 }]), 'bogus'), true);
});

test('kind classification', () => {
  const base = { scope: 'card', pageType: 'search', isSearchResult: true };
  assert.equal(S.classifyKind(base), 'product');
  assert.equal(S.classifyKind({ ...base, hasVideo: true }), 'video');
  assert.equal(S.classifyKind({ ...base, inCarousel: true }), 'carousel');
  assert.equal(S.classifyKind({ scope: 'widget', pageType: 'search', hasBrand: true }), 'brand');
  assert.equal(S.classifyKind({ scope: 'widget', pageType: 'product', hasCarousel: true }), 'carousel');
  assert.equal(S.classifyKind({ scope: 'bare', pageType: 'home', hasAdframe: true }), 'banner');
  assert.equal(S.classifyKind({ scope: 'card', pageType: 'home', isSearchResult: false }), 'recommendation');
  assert.equal(S.classifyKind({ scope: 'widget', pageType: 'other' }), 'other');
});
