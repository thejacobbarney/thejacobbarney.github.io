'use strict';
// Layouts built to trick the heuristics. In every one of them the only acceptable failure is to
// leave an ad in place; hiding anything organic fails the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../fixtures/markup.js');
const C = require('../fixtures/corpus.js');
const H = require('../harness.js');

test.after(() => H.closeBrowser());

const MODES = ['strict', 'balanced', 'aggressive'];
const VERSIONS = { plain: (h) => h, classesRenamed: C.scrambleClasses, hostile: C.hostile };

async function organicSurvives(html, label, pageType = 'product', path = '/dp/B09B8V1LZ3') {
  for (const [vName, transform] of Object.entries(VERSIONS)) {
    for (const mode of MODES) {
      const res = await H.runEngine(transform(html), { pageType, path, settings: { mode } });
      const s = H.score(res.units);
      assert.equal(s.fp, 0, `${label} / ${vName} / ${mode}: organic hidden (${s.falsePos})`);
      assert.deepEqual(res.protectedHidden, [], `${label} / ${vName} / ${mode}: protected landmark hidden`);
    }
  }
}

test('product-less sponsored video next to an organic carousel under a shared parent', async () => {
  const ctx = M.makeCtx(101);
  const videoNoProducts = `<div class="celwidget" data-cel-widget="vid" data-truth="sponsored" data-variant="video-noprod"><span class="a-color-secondary">Sponsored</span><video muted></video><a href="/stores/page/XYZ?ref_=sbv_x">Brand store</a></div>`;
  const html = M.productPage(ctx, [`<section>${videoNoProducts}${M.carousel(ctx, 'organic')}</section>`]);
  await organicSurvives(html, 'video+organic carousel');
});

test('sponsored label sitting OUTSIDE its card as a preceding sibling', async () => {
  const ctx = M.makeCtx(102);
  const parts = [];
  for (let i = 1; i <= 6; i++) {
    parts.push(M.searchCard(ctx, 'organic', 'plain', i * 2 - 1));
    parts.push(`<div class="s-label-row">Sponsored</div>` + M.searchCard(ctx, 'organic', 'plain', i * 2));
  }
  await organicSurvives(M.searchPage(parts), 'outside label', 'search', '/s?k=x');
});

test('"Sponsored" heading above a group of organic cards in a plain div', async () => {
  const ctx = M.makeCtx(103);
  const cards = [1, 2, 3].map((i) => M.searchCard(ctx, 'organic', 'plain', i)).join('');
  const html = M.searchPage([`<div><h3>Sponsored</h3>${cards}</div>`, M.searchCard(ctx, 'organic', 'plain', 4)]);
  await organicSurvives(html, 'heading above organic cards', 'search', '/s?k=x');
});

test('a sponsored label inside an organic review/Q&A region of a product page', async () => {
  const ctx = M.makeCtx(104);
  const reviews = `<div id="reviews"><div class="review"><span class="a-profile-name">Sponsored</span><p>Great product</p></div><div class="review"><span>Alex</span><p>Fine</p></div></div>`;
  const html = M.productPage(ctx, [M.carousel(ctx, 'organic'), reviews]);
  await organicSurvives(html, 'review author named Sponsored');
});

test('one sponsored tile in a grid of organic tiles with identical structure', async () => {
  const ctx = M.makeCtx(105);
  const tiles = [];
  for (let i = 0; i < 6; i++) {
    const sp = i === 2;
    tiles.push(`<div class="tile" data-asin="${M.makeAsin(ctx.rng)}" data-truth="${sp ? 'sponsored' : 'organic'}" data-variant="tile"><a href="${sp ? '/sspa/click?url=%2Fdp%2FB0AAAAAAAA&sp_csd=x' : '/dp/B0BBBBBBBB'}"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>${sp ? '<span>Sponsored</span>' : ''}</div>`);
  }
  const html = M.homePage([`<div class="grid">${tiles.join('')}</div>`]);
  for (const [vName, transform] of Object.entries(VERSIONS)) {
    const res = await H.runEngine(transform(html), { pageType: 'home', path: '/' });
    const s = H.score(res.units);
    assert.equal(s.fp, 0, vName);
    assert.equal(s.tp, 1, vName + ': the sponsored tile itself should still go');
  }
});

test('deeply nested single-child wrappers do not let a hide climb into the page shell', async () => {
  const ctx = M.makeCtx(106);
  let nest = M.searchCard(ctx, 'sponsored', 'textonly', 1);
  for (let i = 0; i < 12; i++) nest = `<div class="w${i}">${nest}</div>`;
  const html = M.searchPage([nest]);
  const res = await H.runEngine(html, { pageType: 'search' });
  assert.deepEqual(res.protectedHidden, []);
  assert.equal(H.score(res.units).tp, 1);
});

test('everything flagged: ratio tripwire inputs are visible to the controller', async () => {
  const ctx = M.makeCtx(107);
  const parts = [];
  for (let i = 1; i <= 10; i++) parts.push(M.searchCard(ctx, 'sponsored', 'modern', i));
  const res = await H.runEngine(M.searchPage(parts), { pageType: 'search' });
  assert.equal(res.report.health.searchResultCards, 10);
  assert.ok(res.report.health.flaggedRatio > 0.65);
});

test('heading-only sponsored carousel with plain product links: removed when structure exists, left alone (not guessed) when it does not', async () => {
  const ctx = M.makeCtx(108);
  const html = M.productPage(ctx, [M.carousel(ctx, 'heading', { plainLinks: true }), M.carousel(ctx, 'organic')]);
  const plain = H.score((await H.runEngine(html, { pageType: 'product', path: '/dp/B09B8V1LZ3' })).units);
  assert.equal(plain.fp, 0);
  assert.equal(plain.tp, 1, 'found via widget structure');
  const renamed = H.score((await H.runEngine(C.scrambleClasses(html), { pageType: 'product', path: '/dp/B09B8V1LZ3' })).units);
  assert.equal(renamed.fp, 0);
  assert.equal(renamed.tp, 1, 'data-cel-widget survives class renames');
  const hostile = await H.runEngine(C.hostile(html), { pageType: 'product', path: '/dp/B09B8V1LZ3' });
  assert.equal(H.score(hostile.units).fp, 0);
  assert.equal(H.score(hostile.units).tp, 0, 'no hook and no per-product evidence: not guessed');
  assert.ok(hostile.report.snapshot.unresolved >= 1, 'but it is surfaced to the user');
});
