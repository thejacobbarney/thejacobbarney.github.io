'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const M = require('../fixtures/markup.js');

const EXT = path.join(__dirname, '..', '..');

/** Pages served at https://www.amazon.com/... via request interception (no network needed). */
function buildSite() {
  const site = {};
  const ctx = () => M.makeCtx(4242);

  {
    const c = ctx();
    const parts = [M.brandBanner(c)];
    const sp = ['modern', 'legacy', 'textonly', 'linkonly', 'ariaonly', 'glyph'];
    let i = 1;
    for (let k = 0; k < 24; k++) {
      if (k % 4 === 1 && sp.length) parts.push(M.searchCard(c, 'sponsored', sp.shift(), i++));
      else parts.push(M.searchCard(c, 'organic', ['plain', 'adversarial', 'badges', 'deal'][k % 4], i++));
      if (k === 8) parts.push(M.searchCarouselBetween(c));
      if (k === 12) parts.push(M.videoAd(c));
    }
    site['/s?k=pencil'] = M.searchPage(parts);
  }
  {
    const c = ctx();
    const parts = [];
    for (let i = 1; i <= 10; i++) parts.push(M.searchCard(c, 'sponsored', 'modern', i));
    site['/s?k=allads'] = M.searchPage(parts);
  }
  {
    const c = ctx();
    site['/dp/B09B8V1LZ3'] = M.productPage(c, [M.carousel(c, 'heading', { plainLinks: true }), M.carousel(c, 'organic'), M.iframeBanner()]);
  }
  {
    const c = ctx();
    const parts = [];
    for (let i = 0; i < 10; i++) parts.push(M.homeCard(c, i % 4 === 2));
    site['/'] = M.homePage(parts);
  }
  site['/s?k=weird'] = M.page('weird', '<div id="a-page"><div id="search"><div class="totally-new-layout"><p>Results</p></div></div></div>');
  {
    const c = ctx();
    const cards = [1, 2, 3].map((i) => M.searchCard(c, 'organic', 'plain', i)).join('');
    site['/s?k=bare'] = M.searchPage([cards, '<p>Intro</p><span>Sponsored</span><p>More</p>']);
  }
  site['/cart'] = M.page('cart', '<div id="a-page"><p>Your cart</p></div>');
  return site;
}

async function launch({ site = buildSite() } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  const requests = [];
  context.on('request', (r) => requests.push({ url: r.url(), fromSW: !!r.serviceWorker() }));
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === 'chrome-extension:' || u.protocol === 'data:') return route.continue();
    if (u.hostname === 'www.amazon.com') {
      const html = site[u.pathname + u.search] || site[u.pathname];
      if (html) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  return { context, sw, extId, requests, profile, site };
}

/** Sends a message to the Amazon tab's content script, via the service worker (same permissions). */
async function contentState(sw, type = 'cs:get-state') {
  return sw.evaluate(async (type) => {
    const tabs = (await chrome.tabs.query({})).sort((a, b) => b.id - a.id); // newest tab first
    for (const t of tabs) {
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type });
        if (r && r.ok) return { tabId: t.id, ...r };
      } catch (e) { /* not an Amazon tab */ }
    }
    return null;
  }, type);
}

async function setSettings(sw, patch) {
  await sw.evaluate(async (patch) => {
    const cur = await CS.settingsStore.load();
    await CS.settingsStore.save({ ...cur, ...patch });
  }, patch);
}

async function resetSettings(sw) {
  await sw.evaluate(() => CS.settingsStore.reset());
}

async function until(fn, { timeout = 5000, interval = 50, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + label);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Summarises ground truth in the page (main world): visible/hidden per truth class. */
async function truthSummary(page) {
  return page.evaluate(() => {
    const out = { sponsoredTotal: 0, sponsoredHidden: 0, organicTotal: 0, organicHidden: 0 };
    for (const el of document.querySelectorAll('[data-truth]')) {
      const hidden = !el.checkVisibility();
      if (el.dataset.truth === 'sponsored') { out.sponsoredTotal++; if (hidden) out.sponsoredHidden++; }
      else { out.organicTotal++; if (hidden) out.organicHidden++; }
    }
    return out;
  });
}

module.exports = { EXT, buildSite, launch, contentState, setSettings, resetSettings, until, truthSummary };
