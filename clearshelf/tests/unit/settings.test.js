'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CS = require('../../src/shared/constants.js');

test('sanitize(null) returns full defaults', () => {
  assert.deepEqual(CS.sanitizeSettings(null), CS.DEFAULT_SETTINGS);
  assert.deepEqual(CS.sanitizeSettings(undefined), CS.DEFAULT_SETTINGS);
  assert.deepEqual(CS.sanitizeSettings('garbage'), CS.DEFAULT_SETTINGS);
});

test('defaults are safe: enabled, balanced, fail-safe on', () => {
  const d = CS.DEFAULT_SETTINGS;
  assert.equal(d.enabled, true);
  assert.equal(d.mode, 'balanced');
  assert.equal(d.failSafe, true);
  assert.equal(d.debug, false);
});

test('wrong types are replaced by defaults, valid values kept', () => {
  const s = CS.sanitizeSettings({ enabled: 'yes', mode: 'nuclear', failSafe: false, pages: { home: false, bogus: true }, placements: { video: 0 } });
  assert.equal(s.enabled, true);
  assert.equal(s.mode, 'balanced');
  assert.equal(s.failSafe, false);
  assert.equal(s.pages.home, false);
  assert.equal('bogus' in s.pages, false);
  assert.equal(s.placements.video, true);
});

test('allowlist: ASINs normalised, deduplicated and validated', () => {
  const s = CS.sanitizeSettings({ allowlist: { asins: ['b08n5wrwnw', 'B08N5WRWNW', 'short', 42, 'B08N5WRWNW1'], selectors: ['#a', '#a', '', 7] } });
  assert.deepEqual(s.allowlist.asins, ['B08N5WRWNW']);
  assert.deepEqual(s.allowlist.selectors, ['#a']);
});

test('allowlist size caps', () => {
  const many = Array.from({ length: 900 }, (_, i) => 'B0' + String(i).padStart(8, '0'));
  assert.equal(CS.sanitizeSettings({ allowlist: { asins: many } }).allowlist.asins.length, 500);
});

test('sanitize is idempotent', () => {
  const once = CS.sanitizeSettings({ mode: 'strict', debug: true, allowlist: { asins: ['B08N5WRWNW'] } });
  assert.deepEqual(CS.sanitizeSettings(once), once);
});

test('parseAsinList', () => {
  assert.deepEqual(CS.parseAsinList('b08n5wrwnw, B0ABCDEFGH\nnope  B0ABCDEFGH'), ['B08N5WRWNW', 'B0ABCDEFGH', 'B0ABCDEFGH']);
});

test('classifyPage', () => {
  const cases = {
    '/': 'home', '': 'home', '/gp/homepage.html': 'home', '/ref=nav_logo': 'home',
    '/s': 'search', '/s/ref=nb_sb_noss': 'search',
    '/Echo-Dot/dp/B09B8V1LZ3/ref=sr_1_1': 'product', '/dp/B09B8V1LZ3': 'product', '/gp/product/B09B8V1LZ3': 'product', '/-/es/dp/B09B8V1LZ3': 'product',
    '/b': 'category', '/b/ref=x': 'category', '/gp/browse.html': 'category', '/gp/bestsellers/electronics': 'category', '/Electronics/b': 'category', '/deals': 'category',
    '/cart': 'other', '/gp/cart/view.html': 'other', '/gp/your-account': 'other',
  };
  for (const [p, want] of Object.entries(cases)) assert.equal(CS.classifyPage(p), want, p);
});

test('isSupportedHost accepts amazon.com only', () => {
  assert.equal(CS.isSupportedHost('www.amazon.com'), true);
  assert.equal(CS.isSupportedHost('amazon.com'), true);
  assert.equal(CS.isSupportedHost('smile.amazon.com'), true);
  assert.equal(CS.isSupportedHost('evilamazon.com'), false);
  assert.equal(CS.isSupportedHost('amazon.com.evil.example'), false);
  assert.equal(CS.isSupportedHost('www.amazon.co.uk'), false, 'planned, not active');
});
