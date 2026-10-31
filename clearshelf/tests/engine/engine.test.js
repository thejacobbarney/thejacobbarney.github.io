'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../fixtures/markup.js');
const H = require('../harness.js');

test.after(() => H.closeBrowser());

const SPONSORED_SEARCH = ['modern', 'legacy', 'textonly', 'glyph', 'linkonly', 'ariaonly', 'spanish', 'german'];

function mixedSearch(seed = 1, { weak = false } = {}) {
  const ctx = M.makeCtx(seed);
  const parts = [M.brandBanner(ctx)];
  const sp = [...SPONSORED_SEARCH, ...(weak ? ['weakad'] : [])];
  let i = 1;
  for (let k = 0; k < 28; k++) {
    if (k % 3 === 1 && sp.length) parts.push(M.searchCard(ctx, 'sponsored', sp.shift(), i++));
    else parts.push(M.searchCard(ctx, 'organic', ['plain', 'adversarial', 'badges', 'deal'][k % 4], i++));
    if (k === 6) parts.push(M.videoAd(ctx));
    if (k === 10) parts.push(M.searchCarouselBetween(ctx));
  }
  return M.searchPage(parts);
}

test('standard mixed search page: every sponsored placement removed, every organic one kept', async () => {
  const res = await H.runEngine(mixedSearch(), { pageType: 'search' });
  const s = H.score(res.units);
  assert.equal(s.fp, 0, 'organic hidden: ' + s.falsePos);
  assert.equal(s.fn, 0, 'sponsored missed: ' + s.misses);
  assert.ok(s.sponsored >= 11);
  assert.deepEqual(res.protectedHidden, []);
});

test('hidden elements really are display:none', async () => {
  const res = await H.runEngine(mixedSearch(2), { pageType: 'search' });
  for (const u of res.units.filter((u) => u.truth === 'sponsored')) assert.equal(u.displayNone, true, u.variant);
});

test('adversarial organic titles (Ad Hoc, Sponsored, etc.) are never hidden', async () => {
  const ctx = M.makeCtx(5);
  const parts = [];
  for (let i = 1; i <= 16; i++) parts.push(M.searchCard(ctx, 'organic', 'adversarial', i));
  parts.push(M.searchCard(ctx, 'sponsored', 'modern', 17));
  for (const mode of ['strict', 'balanced', 'aggressive']) {
    const res = await H.runEngine(M.searchPage(parts), { pageType: 'search', settings: { mode } });
    const s = H.score(res.units);
    assert.equal(s.fp, 0, `${mode}: ${s.falsePos}`);
  }
});

test('a lone weak "Ad" label is kept in balanced mode, removed only in aggressive', async () => {
  const ctx = M.makeCtx(6);
  const parts = [M.searchCard(ctx, 'organic', 'plain', 1), M.searchCard(ctx, 'sponsored', 'weakad', 2), M.searchCard(ctx, 'organic', 'plain', 3)];
  const bal = H.score((await H.runEngine(M.searchPage(parts), { settings: { mode: 'balanced' } })).units);
  assert.equal(bal.tp, 0);
  const agg = H.score((await H.runEngine(M.searchPage(parts), { settings: { mode: 'aggressive' } })).units);
  assert.equal(agg.tp, 1);
  assert.equal(agg.fp, 0);
});

test('strict mode needs two kinds of evidence', async () => {
  const ctx = M.makeCtx(7);
  const parts = [
    M.searchCard(ctx, 'sponsored', 'modern', 1), // label + class + link + feedback
    M.searchCard(ctx, 'sponsored', 'textonly', 2), // label only
    M.searchCard(ctx, 'sponsored', 'linkonly', 3), // link only
    M.searchCard(ctx, 'organic', 'plain', 4),
  ];
  const res = await H.runEngine(M.searchPage(parts), { settings: { mode: 'strict' } });
  const byVariant = Object.fromEntries(res.units.map((u) => [u.variant, u.hidden]));
  assert.equal(byVariant.modern, true);
  assert.equal(byVariant.textonly, false);
  assert.equal(byVariant.linkonly, false);
});

test('sponsored carousel on a product page: whole module goes, organic carousel and buy box stay', async () => {
  const ctx = M.makeCtx(8);
  const html = M.productPage(ctx, [M.carousel(ctx, 'heading'), M.carousel(ctx, 'organic'), M.iframeBanner()]);
  const res = await H.runEngine(html, { pageType: 'product', path: '/Echo/dp/B09B8V1LZ3' });
  const s = H.score(res.units);
  assert.equal(s.fp, 0);
  assert.equal(s.fn, 0, s.misses.join());
  assert.deepEqual(res.protectedHidden, []);
});

test('per-card labelled carousel: sponsored cards removed and the empty shell collapses', async () => {
  const ctx = M.makeCtx(9);
  const html = M.productPage(ctx, [M.carousel(ctx, 'perCard', { id: 'adx_1', count: 5 }), M.carousel(ctx, 'organic')]);
  const res = await H.runEngine(html, { pageType: 'product', path: '/dp/B09B8V1LZ3' });
  const s = H.score(res.units);
  assert.equal(s.fn, 0);
  assert.equal(s.fp, 0);
});

test('organic carousel with one individually sponsored card: only that card goes', async () => {
  const ctx = M.makeCtx(10);
  const cards = [M.carouselCard(ctx, false), M.carouselCard(ctx, true, '<span class="a-size-mini">Sponsored</span>'), M.carouselCard(ctx, false), M.carouselCard(ctx, false)];
  const html = M.productPage(ctx, [`<div class="celwidget" id="sims" data-cel-widget="sims"><div class="a-carousel-container"><h2>Related</h2><ol class="a-carousel">${cards.join('')}</ol></div></div>`]);
  const fx = await H.openFixture(html, { path: '/dp/B09B8V1LZ3' });
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'product' });
      e.scan(document.documentElement);
      return { hiddenCards: document.querySelectorAll('li.a-carousel-card[data-cs-hidden]').length, widgetHidden: document.getElementById('sims').hasAttribute('data-cs-hidden'), total: document.querySelectorAll('li.a-carousel-card').length };
    });
    assert.equal(out.hiddenCards, 1);
    assert.equal(out.widgetHidden, false);
    assert.equal(out.total, 4);
  } finally { await fx.close(); }
});

test('homepage: sponsored cards removed, organic cards and hero kept', async () => {
  const ctx = M.makeCtx(11);
  const parts = [];
  for (let i = 0; i < 10; i++) parts.push(M.homeCard(ctx, i % 4 === 2));
  parts.push(M.iframeBanner('desktop-ad-atf'));
  const res = await H.runEngine(M.homePage(parts), { pageType: 'home', path: '/' });
  const s = H.score(res.units);
  assert.equal(s.fp, 0);
  assert.equal(s.fn, 0, s.misses.join());
});

test('the word "Sponsored" in the footer or nav never triggers removal', async () => {
  const ctx = M.makeCtx(12);
  const parts = [];
  for (let i = 1; i <= 8; i++) parts.push(M.searchCard(ctx, 'organic', 'plain', i));
  const res = await H.runEngine(M.searchPage(parts), { pageType: 'search' });
  assert.equal(res.report.snapshot.detected, 0);
  assert.deepEqual(res.protectedHidden, []);
});

test('a bare "Sponsored" label with no safe container is reported, not guessed at', async () => {
  const html = M.page('x', '<div id="a-page"><div id="search"><p>Intro</p><span>Sponsored</span><p>More text</p></div></div>');
  const res = await H.runEngine(html, { pageType: 'search' });
  assert.equal(res.report.snapshot.detected, 0);
  assert.equal(res.report.snapshot.unresolved, 1);
  assert.equal(res.report.unresolved[0].reason, 'no-container');
});

test('a container that also holds an unflagged organic result is never hidden', async () => {
  // A "Sponsored" label sits in a module wrapper that also wraps an organic search result.
  const ctx = M.makeCtx(13);
  const organic = M.searchCard(ctx, 'organic', 'plain', 1);
  const html = M.searchPage([`<div class="s-widget celwidget" data-cel-widget="mixed"><span>Sponsored</span>${organic}</div>`]);
  const res = await H.runEngine(html, { pageType: 'search' });
  const s = H.score(res.units);
  assert.equal(s.fp, 0);
  assert.equal(res.report.snapshot.detected, 0);
  assert.equal(res.report.snapshot.unresolved, 1, 'surfaced as unresolved instead of guessed');
});

test('placement toggles: disabled kinds are left alone', async () => {
  const res = await H.runEngine(mixedSearch(3), { settings: { placements: { product: false } } });
  const sponsoredProducts = res.units.filter((u) => u.truth === 'sponsored' && u.kind === '' && ['modern', 'legacy', 'textonly', 'glyph', 'linkonly', 'ariaonly', 'spanish', 'german'].includes(u.variant));
  assert.ok(sponsoredProducts.length >= 8);
  assert.ok(sponsoredProducts.every((u) => !u.hidden), 'products kept');
  const others = res.units.filter((u) => u.truth === 'sponsored' && ['brand', 'video', 'search-carousel'].includes(u.variant));
  assert.ok(others.every((u) => u.hidden), 'other kinds still removed');
});

test('allowlist by ASIN protects that product only', async () => {
  const ctx = M.makeCtx(14);
  const parts = [M.searchCard(ctx, 'sponsored', 'modern', 1), M.searchCard(ctx, 'sponsored', 'modern', 2), M.searchCard(ctx, 'organic', 'plain', 3)];
  const html = M.searchPage(parts);
  const asin = /data-asin="([A-Z0-9]{10})"/.exec(parts[0])[1];
  const res = await H.runEngine(html, { settings: { allowlist: { asins: [asin] } } });
  assert.deepEqual(res.units.map((u) => u.hidden), [false, true, false]);
});

test('allowlist by CSS selector protects matching modules', async () => {
  const ctx = M.makeCtx(15);
  const html = M.productPage(ctx, [M.carousel(ctx, 'heading'), M.iframeBanner()]);
  const res = await H.runEngine(html, { pageType: 'product', path: '/dp/B09B8V1LZ3', settings: { allowlist: { selectors: ['#sp_detail', ':::not-a-selector'] } } });
  const byVariant = Object.fromEntries(res.units.map((u) => [u.variant, u.hidden]));
  assert.equal(byVariant['carousel-heading'], false);
  assert.equal(byVariant['iframe-banner'], true);
});

test('incremental scans: ads that arrive later are removed, organic arrivals are kept', async () => {
  const ctx = M.makeCtx(16);
  const html = M.searchPage([M.searchCard(ctx, 'organic', 'plain', 1)]);
  const late = [M.searchCard(ctx, 'sponsored', 'modern', 2), M.searchCard(ctx, 'organic', 'plain', 3), M.searchCard(ctx, 'sponsored', 'textonly', 4)];
  const fx = await H.openFixture(html);
  try {
    const out = await fx.page.evaluate((late) => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      document.documentElement.setAttribute('data-cs-on', '1');
      e.scan(document.documentElement);
      const slot = document.querySelector('.s-main-slot');
      const added = [];
      for (const h of late) {
        const t = document.createElement('template');
        t.innerHTML = h;
        const el = t.content.firstElementChild;
        slot.appendChild(el);
        added.push(el);
        e.scan(el); // what the controller does for each added root
      }
      return [...document.querySelectorAll('[data-truth]')].map((el) => [el.dataset.truth, !!el.closest('[data-cs-hidden]')]);
    }, late);
    assert.deepEqual(out, [['organic', false], ['sponsored', true], ['organic', false], ['sponsored', true]]);
  } finally { await fx.close(); }
});

test('a label added to an existing card later (partial subtree scan) still hides the whole card', async () => {
  const ctx = M.makeCtx(17);
  const html = M.searchPage([M.searchCard(ctx, 'organic', 'plain', 1), M.searchCard(ctx, 'organic', 'plain', 2)]);
  const fx = await H.openFixture(html);
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      e.scan(document.documentElement);
      const card = document.querySelector('[data-asin]');
      const row = card.querySelector('.a-section.a-spacing-small');
      const span = document.createElement('span');
      span.textContent = 'Sponsored';
      row.prepend(span);
      e.scan(span);
      return card.hasAttribute('data-cs-hidden');
    });
    assert.equal(out, true);
  } finally { await fx.close(); }
});

test('removing the evidence un-hides the unit (no stale hiding)', async () => {
  const ctx = M.makeCtx(18);
  const html = M.searchPage([M.searchCard(ctx, 'sponsored', 'textonly', 1), M.searchCard(ctx, 'organic', 'plain', 2)]);
  const fx = await H.openFixture(html);
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      e.scan(document.documentElement);
      const card = document.querySelector('[data-asin]');
      const before = card.hasAttribute('data-cs-hidden');
      const label = [...card.querySelectorAll('span')].find((s) => s.textContent === 'Sponsored');
      label.remove();
      e.scan(card.querySelector('.a-section.a-spacing-small'));
      return { before, after: card.hasAttribute('data-cs-hidden'), detected: e.snapshot().detected };
    });
    assert.deepEqual(out, { before: true, after: false, detected: 0 });
  } finally { await fx.close(); }
});

test('scanning twice is idempotent and does not double count', async () => {
  const fx = await H.openFixture(mixedSearch(19));
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      e.scan(document.documentElement);
      const a = e.snapshot();
      e.scan(document.documentElement);
      e.scan(document.documentElement);
      const b = e.snapshot();
      return { a: [a.detected, a.removedTotal], b: [b.detected, b.removedTotal] };
    });
    assert.deepEqual(out.a, out.b);
    assert.ok(out.a[0] >= 11);
  } finally { await fx.close(); }
});

test('clearAll restores every element (master switch off)', async () => {
  const fx = await H.openFixture(mixedSearch(20));
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      e.scan(document.documentElement);
      e.clearAll();
      return document.querySelectorAll('[data-cs-hidden],[data-cs-kind],[data-cs-conf],[data-cs-why]').length;
    });
    assert.equal(out, 0);
  } finally { await fx.close(); }
});

test('a hostile mutation: ad-ish ids on a container holding organic results never hide it', async () => {
  const ctx = M.makeCtx(21);
  const cards = [1, 2, 3, 4].map((i) => M.searchCard(ctx, 'organic', 'plain', i)).join('');
  const html = M.searchPage([`<div id="sponsoredProducts2_feature_div" class="celwidget" data-cel-widget="adplacements_x">${cards}</div>`]);
  for (const mode of ['balanced', 'aggressive']) {
    const res = await H.runEngine(html, { settings: { mode } });
    assert.equal(H.score(res.units).fp, 0, mode);
  }
});

test('removed count equals the number of placements: cards later absorbed by a module are not double counted', async () => {
  const fx = await H.openFixture(mixedSearch(22));
  try {
    const out = await fx.page.evaluate(() => {
      const e = CS.createEngine({ settings: {}, pageType: 'search' });
      e.scan(document.documentElement);
      const s = e.snapshot();
      return { detected: s.detected, removed: s.removedTotal };
    });
    assert.equal(out.removed, out.detected);
  } finally { await fx.close(); }
});
