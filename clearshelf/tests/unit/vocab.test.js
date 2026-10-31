'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../src/shared/constants.js');
const V = require('../../src/content/vocab.js');

test('matches the bare label in several forms', () => {
  for (const t of ['Sponsored', ' sponsored ', 'SPONSORED', 'Sponsored ⓘ', 'Sponsored​', 'Sponsored.', ' Sponsored ']) {
    const m = V.matchLabelText(t);
    assert.ok(m, JSON.stringify(t));
    assert.equal(m.form, 'exact');
    assert.equal(m.weight, V.FAMILY_WEIGHT.label);
  }
});

test('localised labels match', () => {
  for (const t of ['Patrocinado', 'Anzeige', 'Sponsorisé', 'Sponsorizzato', 'Gesponsord', '広告', 'スポンサー']) {
    assert.ok(V.matchLabelText(t), t);
  }
});

test('"Ad" and "Advertisement" are weak evidence only', () => {
  assert.equal(V.matchLabelText('Ad').form, 'weak');
  assert.ok(V.matchLabelText('Ad').weight < CS.MODES.balanced.threshold);
});

test('suffixed forms are weaker than the bare label', () => {
  const m = V.matchLabelText('Sponsored by Anker');
  assert.equal(m.form, 'suffixed');
  assert.ok(m.weight < CS.MODES.balanced.threshold);
});

test('product titles and prose containing ad words do NOT match', () => {
  const organic = [
    'Ad Hoc Wireless Networking: A Practical Handbook',
    'The Sponsored Content Playbook: A Marketer’s Guide',
    'Sponsored Content Marketing',
    'Adidas Mens Running Shoes',
    'Add to Cart',
    'Advertisement Design and Layout Principles',
    'This was a sponsored review and I loved it',
    'Interest-Based Ads',
    'Ads Mavens: Facebook Advertising Made Simple',
    '',
    'x'.repeat(200),
  ];
  for (const t of organic) assert.equal(V.matchLabelText(t), null, t.slice(0, 60));
});

test('aria-label prefix form is recognised, plain titles are not', () => {
  assert.equal(V.matchLabelAttr('Sponsored Ad – Anker USB C Cable').form, 'aria-prefix');
  assert.equal(V.matchLabelAttr('Sponsored Ad - Anker USB C Cable').family, 'label');
  assert.equal(V.matchLabelAttr('View Sponsored information or leave ad feedback').family, 'feedback');
  assert.equal(V.matchLabelAttr('Ad feedback').family, 'feedback');
  assert.equal(V.matchLabelAttr('Sponsored Content Marketing: A Guide'), null);
  assert.equal(V.matchLabelAttr('Anker USB C Cable'), null);
  assert.equal(V.matchLabelAttr(''), null);
});

test('normalizeText folds info glyphs without producing a stray "i"', () => {
  assert.equal(V.normalizeText('Sponsored ⓘ'), 'sponsored');
  assert.equal(V.normalizeText('Sponsored ℹ'), 'sponsored');
});
