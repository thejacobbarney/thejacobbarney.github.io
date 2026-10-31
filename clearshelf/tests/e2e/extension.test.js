'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('./helpers.js');
const M = require('../fixtures/markup.js');

let env;
const URL_ = (p) => 'https://www.amazon.com' + p;

test.before(async () => { env = await E.launch(); });
test.after(async () => { await env.context.close(); });

async function open(p) {
  const page = await env.context.newPage();
  await page.goto(URL_(p));
  return page;
}

test.beforeEach(async () => { await E.resetSettings(env.sw); });
// A failing test must not leak its tab into later tests.
test.afterEach(async () => { for (const p of env.context.pages()) await p.close().catch(() => {}); });

test('search page: sponsored removed, organic intact, at load', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0, { label: 'ads hidden' });
  const s = await E.truthSummary(page);
  assert.equal(s.sponsoredHidden, s.sponsoredTotal, 'all sponsored hidden');
  assert.equal(s.organicHidden, 0, 'no organic hidden');
  assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('data-cs-on')));
  await page.close();
});

test('the page footer and nav are untouched', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const vis = await page.evaluate(() => ['navbar', 'nav-belt', 'twotabsearchtextbox', 's-refinements', 'navFooter'].map((id) => document.getElementById(id).checkVisibility()));
  assert.deepEqual(vis, [true, true, true, true, true]);
  await page.close();
});

test('state reported to the popup channel matches the page', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  await page.waitForTimeout(300);
  const st = (await E.contentState(env.sw)).state;
  const truth = await E.truthSummary(page);
  assert.equal(st.status === 'active' || st.status === 'partial', true);
  assert.ok(st.detected >= 5, 'detected ' + st.detected);
  assert.ok(st.removedOnPage >= st.detected);
  assert.equal(st.pageType, 'search');
  assert.ok(st.byKind.product >= 1 && st.byKind.brand >= 1 && st.byKind.video >= 1, JSON.stringify(st.byKind));
  assert.ok(truth.sponsoredHidden > 0);
  await page.close();
});

test('dynamically inserted ads are removed quickly; organic insertions are kept', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const c = M.makeCtx(9001);
  const ad = M.searchCard(c, 'sponsored', 'modern', 901);
  const adText = M.searchCard(c, 'sponsored', 'textonly', 902);
  const org = M.searchCard(c, 'organic', 'plain', 903);
  const timing = await page.evaluate(async ([ad, adText, org]) => {
    const slot = document.querySelector('.s-main-slot');
    const insert = (h) => { const t = document.createElement('template'); t.innerHTML = h; const el = t.content.firstElementChild; slot.appendChild(el); return el; };
    const t0 = performance.now();
    const els = [insert(ad), insert(adText), insert(org)];
    // Poll via timers (not rAF) so this also works in a background tab.
    const hidden = () => els.map((e) => !e.checkVisibility());
    while (!(hidden()[0] && hidden()[1]) && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 5));
    return { ms: Math.round(performance.now() - t0), hidden: hidden() };
  }, [ad, adText, org]);
  assert.deepEqual(timing.hidden, [true, true, false]);
  assert.ok(timing.ms < 1000, 'took ' + timing.ms + 'ms');
  console.log('# dynamic insert -> hidden in', timing.ms, 'ms');
  await page.close();
});

test('infinite scroll: repeated batches are all handled', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const c = M.makeCtx(9002);
  for (let b = 0; b < 5; b++) {
    const batch = [];
    for (let i = 0; i < 12; i++) batch.push(i % 4 === 1 ? M.searchCard(c, 'sponsored', ['modern', 'textonly', 'legacy'][b % 3], 1000 + b * 20 + i) : M.searchCard(c, 'organic', 'plain', 1000 + b * 20 + i));
    await page.evaluate((html) => {
      const slot = document.querySelector('.s-main-slot');
      const t = document.createElement('template');
      t.innerHTML = html.join('');
      slot.appendChild(t.content);
    }, batch);
    await page.waitForTimeout(80);
  }
  await E.until(async () => { const s = await E.truthSummary(page); return s.sponsoredHidden === s.sponsoredTotal; }, { label: 'all batches hidden' });
  const s = await E.truthSummary(page);
  assert.equal(s.organicHidden, 0);
  await page.close();
});

test('same-document navigation (SPA style) to a product page is handled', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const productHtml = env.site['/dp/B09B8V1LZ3'];
  await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.body.replaceWith(doc.body);
    history.pushState({}, '', '/dp/B09B8V1LZ3');
  }, productHtml);
  await E.until(async () => { const s = await E.truthSummary(page); return s.sponsoredTotal > 0 && s.sponsoredHidden === s.sponsoredTotal; }, { label: 'PDP ads hidden after navigation', timeout: 6000 });
  const s = await E.truthSummary(page);
  assert.equal(s.organicHidden, 0);
  const st = (await E.contentState(env.sw)).state;
  assert.equal(st.pageType, 'product');
  assert.equal(await page.evaluate(() => ['productTitle', 'add-to-cart-button', 'buybox'].every((id) => document.getElementById(id).checkVisibility())), true);
  await page.close();
});

test('product page: sponsored carousel and banner removed, organic carousel and buy box kept', async () => {
  const page = await open('/dp/B09B8V1LZ3');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const s = await E.truthSummary(page);
  assert.equal(s.sponsoredHidden, s.sponsoredTotal);
  assert.equal(s.organicHidden, 0);
  await page.close();
});

test('homepage: sponsored cards removed, others kept', async () => {
  const page = await open('/');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const s = await E.truthSummary(page);
  assert.equal(s.sponsoredHidden, s.sponsoredTotal);
  assert.equal(s.organicHidden, 0);
  await page.close();
});

test('master switch off restores everything instantly, on hides again', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  await E.setSettings(env.sw, { enabled: false });
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden === 0, { label: 'restored' });
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-cs-on')), false);
  assert.equal((await E.contentState(env.sw)).state.status, 'disabled');
  await E.setSettings(env.sw, { enabled: true });
  await E.until(async () => { const s = await E.truthSummary(page); return s.sponsoredHidden === s.sponsoredTotal; }, { label: 'hidden again' });
  await page.close();
});

test('placement and page toggles are honoured live', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  await E.setSettings(env.sw, { placements: { ...(await env.sw.evaluate(() => CS.DEFAULT_SETTINGS.placements)), video: false } });
  await E.until(async () => page.evaluate(() => [...document.querySelectorAll('[data-variant="video"]')].every((e) => e.checkVisibility())), { label: 'video restored' });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-variant="brand"]')].every((e) => !e.checkVisibility())), true, 'brand still hidden');
  await E.setSettings(env.sw, { pages: { home: true, search: false, category: true, product: true, other: true } });
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden === 0, { label: 'search page turned off' });
  assert.equal((await E.contentState(env.sw)).state.status, 'page-off');
  await page.close();
});

test('debug mode outlines instead of hiding and records reasons', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  await E.setSettings(env.sw, { debug: true });
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden === 0, { label: 'debug shows items' });
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-cs-hidden]');
    return { outline: getComputedStyle(el).outlineStyle, why: el.getAttribute('data-cs-why'), conf: el.getAttribute('data-cs-conf'), badge: getComputedStyle(el, '::before').content };
  });
  assert.equal(info.outline, 'dashed');
  assert.ok(info.why && info.conf);
  assert.match(info.badge, /SPONSORED/);
  const diag = (await E.contentState(env.sw, 'cs:get-diagnostics')).report;
  assert.ok(diag.decisions.length > 5);
  const blob = JSON.stringify(diag);
  assert.equal(/https?:\/\//.test(blob), false, 'diagnostics contain no URLs');
  assert.equal(/Anker|Echo Dot|Logitech/.test(blob), false, 'diagnostics contain no product titles');
  await page.close();
});

test('allowlist (ASIN + selector) is honoured', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const asin = await page.evaluate(() => document.querySelector('[data-truth="sponsored"][data-asin]').dataset.asin);
  await E.setSettings(env.sw, { allowlist: { asins: [asin], selectors: ['[data-variant="video"]'] } });
  await E.until(async () => page.evaluate((a) => document.querySelector('[data-asin="' + a + '"]').checkVisibility(), asin), { label: 'allowlisted ASIN shown' });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-variant="video"]')].every((e) => e.checkVisibility())), true);
  const s = await E.truthSummary(page);
  assert.ok(s.sponsoredHidden > 0 && s.sponsoredHidden < s.sponsoredTotal);
  await page.close();
});

test('fail-safe tripwire: a page where nearly everything looks sponsored is left alone', async () => {
  const page = await open('/s?k=allads');
  await E.until(async () => (await E.contentState(env.sw)).state.status === 'tripped', { label: 'tripwire' });
  const s = await E.truthSummary(page);
  assert.equal(s.sponsoredHidden, 0, 'nothing hidden after tripwire');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-cs-on')), false);
  await page.close();
});

test('fail-safe off: the same page is processed normally', async () => {
  await E.setSettings(env.sw, { failSafe: false });
  const page = await open('/s?k=allads');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0, { label: 'hidden without failsafe' });
  assert.equal((await E.truthSummary(page)).sponsoredHidden, 10);
  await page.close();
});

test('unsupported layout: status, toast and badge', async () => {
  const page = await open('/s?k=weird');
  await E.until(async () => (await E.contentState(env.sw)).state.status === 'unsupported', { timeout: 8000, label: 'unsupported status' });
  await E.until(async () => page.evaluate(() => !!document.querySelector('[data-cs-toast]')), { label: 'toast' });
  const tabId = (await E.contentState(env.sw)).tabId;
  await E.until(async () => (await env.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)) === '?', { label: 'badge ?' });
  await page.close();
});

test('stray sponsored label with no safe container: partial status, nothing hidden, user informed', async () => {
  const page = await open('/s?k=bare');
  await E.until(async () => (await E.contentState(env.sw)).state.status === 'partial', { timeout: 8000, label: 'partial status' });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('p, span')].every((e) => e.checkVisibility())), true);
  await E.until(async () => page.evaluate(() => !!document.querySelector('[data-cs-toast]')), { label: 'toast' });
  await page.close();
});

test('toast respects "notify" setting', async () => {
  await E.setSettings(env.sw, { notifyUnsupported: false });
  const page = await open('/s?k=bare');
  await E.until(async () => (await E.contentState(env.sw)).state.status === 'partial', { timeout: 8000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-cs-toast]')), false);
  await page.close();
});

test('session statistics and badge are maintained by the service worker', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  const tabId = (await E.contentState(env.sw)).tabId;
  const st = (await E.contentState(env.sw)).state;
  await E.until(async () => {
    const sess = await env.sw.evaluate(async () => (await chrome.storage.session.get(CS.STORAGE.session))[CS.STORAGE.session]);
    return sess && sess.removedTotal >= st.removedOnPage && sess.tabs[tabId] && sess.tabs[tabId].removedOnPage === st.removedOnPage;
  }, { label: 'session stats', timeout: 4000 });
  const badge = await env.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  assert.equal(badge, String(st.removedOnPage));
  await page.close();
});

test('popup: renders live state, toggles persist, reset works', async () => {
  const shot = path.join(__dirname, '..', '..', 'docs', 'screens');
  fs.mkdirSync(shot, { recursive: true });
  const popup = await env.context.newPage();
  await popup.setViewportSize({ width: 372, height: 720 });
  await popup.goto(`chrome-extension://${env.extId}/src/popup/popup.html`);
  const amazon = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(amazon)).sponsoredHidden > 0);
  await amazon.bringToFront();
  await E.until(async () => (await popup.textContent('#status-title')) === 'Active', { timeout: 6000, label: 'popup shows Active' });
  assert.ok(Number(await popup.textContent('#stat-page')) > 0);
  assert.ok(Number(await popup.textContent('#stat-detected')) > 0);
  assert.ok(Number(await popup.textContent('#stat-session')) > 0);
  assert.match(await popup.textContent('#host-line'), /www\.amazon\.com/);
  await popup.screenshot({ path: path.join(shot, 'popup-overview.png') });

  // Master toggle
  await popup.locator('#master').uncheck({ force: true });
  await E.until(async () => (await env.sw.evaluate(async () => (await CS.settingsStore.load()).enabled)) === false, { label: 'enabled=false persisted' });
  await E.until(async () => (await popup.textContent('#status-title')) === 'Paused');
  await popup.locator('#master').check({ force: true });
  await E.until(async () => (await env.sw.evaluate(async () => (await CS.settingsStore.load()).enabled)) === true);

  // Settings view
  await popup.click('#tab-settings');
  await popup.locator('input[name="mode"][value="strict"]').check({ force: true });
  await popup.locator('#pl-video').uncheck({ force: true });
  await popup.fill('#allow-asins', 'B0ABCDEFGH\nnot-an-asin');
  await popup.fill('#allow-selectors', '#sp_detail\n:::bad');
  await E.until(async () => (await env.sw.evaluate(async () => (await CS.settingsStore.load()).allowlist.asins.length)) === 1, { label: 'allowlist persisted' });
  const saved = await env.sw.evaluate(async () => CS.settingsStore.load());
  assert.equal(saved.mode, 'strict');
  assert.equal(saved.placements.video, false);
  assert.deepEqual(saved.allowlist.asins, ['B0ABCDEFGH']);
  assert.deepEqual(saved.allowlist.selectors, ['#sp_detail']);
  assert.match(await popup.textContent('#allow-msg'), /ignored/);
  await popup.evaluate(() => { document.documentElement.scrollTop = 0; });
  await popup.screenshot({ path: path.join(shot, 'popup-settings.png'), fullPage: true });

  // Domains listed
  const domains = await popup.locator('#domains li').allTextContents();
  assert.ok(domains.some((d) => d.includes('amazon.com') && d.includes('Active')));

  // Reset (two-step confirm)
  await popup.click('#btn-reset');
  assert.match(await popup.textContent('#btn-reset'), /confirm/i);
  await popup.click('#btn-reset');
  await E.until(async () => (await env.sw.evaluate(async () => (await CS.settingsStore.load()).mode)) === 'balanced', { label: 'reset persisted' });
  const after = await env.sw.evaluate(async () => CS.settingsStore.load());
  assert.deepEqual(after, await env.sw.evaluate(() => CS.sanitizeSettings(null)));
  await amazon.close();
  await popup.close();
});

test('popup on a non-Amazon tab explains itself', async () => {
  const other = await env.context.newPage();
  await other.goto('about:blank');
  const popup = await env.context.newPage();
  await popup.goto(`chrome-extension://${env.extId}/src/popup/popup.html`);
  await other.bringToFront();
  await E.until(async () => (await popup.textContent('#status-title')) === 'Not an Amazon page', { timeout: 6000 });
  await popup.close();
  await other.close();
});

test('privacy: no network requests were made by the extension, and none beyond the page itself', async () => {
  const page = await open('/s?k=pencil');
  await E.until(async () => (await E.truthSummary(page)).sponsoredHidden > 0);
  await page.waitForTimeout(500);
  // The worker loading its own bundled files (chrome-extension://) is not network traffic.
  const fromSW = env.requests.filter((r) => r.fromSW && !r.url.startsWith('chrome-extension://'));
  assert.deepEqual(fromSW, [], 'service worker made requests');
  const foreign = env.requests.filter((r) => !/^(https:\/\/www\.amazon\.com\/|https:\/\/c\.amazon-adsystem\.com\/|chrome-extension:|data:|about:)/.test(r.url));
  assert.deepEqual(foreign, [], 'unexpected requests: ' + JSON.stringify(foreign));
  await page.close();
});
