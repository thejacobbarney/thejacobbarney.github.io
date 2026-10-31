/*
 * Performance benchmark: identical Chromium, with and without the extension, on a large
 * synthetic search page. Reports medians over N runs.
 *
 *   node tests/bench/perf.js [runs=9] [--json out.json]
 *
 * Numbers are for synthetic fixtures on this machine: use them to compare on/off and to spot
 * regressions, not as absolute figures for real Amazon pages.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const M = require('../fixtures/markup.js');

const EXT = path.join(__dirname, '..', '..');

function bigSearchPage(cards = 300) {
  const c = M.makeCtx(77);
  const parts = [M.brandBanner(c)];
  for (let i = 1; i <= cards; i++) {
    parts.push(i % 7 === 3 ? M.searchCard(c, 'sponsored', ['modern', 'legacy', 'textonly'][i % 3], i) : M.searchCard(c, 'organic', ['plain', 'badges', 'adversarial'][i % 3], i));
    if (i % 60 === 0) parts.push(M.searchCarouselBetween(c));
  }
  return M.searchPage(parts);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function launch(withExt) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-perf-'));
  const args = withExt ? ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT] : [];
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, args });
  const html = bigSearchPage();
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.protocol === 'chrome-extension:' || u.protocol === 'data:') return r.continue();
    if (u.hostname === 'www.amazon.com') return r.fulfill({ status: 200, contentType: 'text/html', body: html });
    return r.fulfill({ status: 204, body: '' });
  });
  if (withExt) { if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker'); }
  return ctx;
}

async function measureLoad(ctx) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto('https://www.amazon.com/s?k=perf', { waitUntil: 'load' });
  await page.waitForTimeout(4200); // let settle scans finish so their cost is included
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-truth="sponsored"]')].filter((e) => !e.checkVisibility()).length);
  const total = await page.evaluate(() => document.querySelectorAll('[data-truth="sponsored"]').length);
  await page.close();
  return {
    dcl: nav.dcl, load: nav.load,
    scriptMs: metrics.ScriptDuration * 1000, taskMs: metrics.TaskDuration * 1000,
    layoutMs: metrics.LayoutDuration * 1000, styleMs: metrics.RecalcStyleDuration * 1000,
    heapMB: metrics.JSHeapUsedSize / 1048576, nodes: metrics.Nodes, hidden, total,
  };
}

/** Mutation stress: append many nodes in bursts and time until the page is quiet. */
async function measureMutations(ctx) {
  const page = await ctx.newPage();
  await page.goto('https://www.amazon.com/s?k=perf', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const c = M.makeCtx(5);
  const batches = [];
  for (let b = 0; b < 20; b++) {
    const arr = [];
    for (let i = 0; i < 25; i++) arr.push(i % 5 === 1 ? M.searchCard(c, 'sponsored', 'textonly', 5000 + b * 25 + i) : M.searchCard(c, 'organic', 'plain', 5000 + b * 25 + i));
    batches.push(arr.join(''));
  }
  const res = await page.evaluate(async (batches) => {
    const slot = document.querySelector('.s-main-slot');
    let longest = 0;
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration); });
    try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const t0 = performance.now();
    for (const h of batches) {
      const t = document.createElement('template');
      t.innerHTML = h;
      slot.appendChild(t.content);
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 400));
    return { wallMs: performance.now() - t0, longestTaskMs: longest, hiddenNew: [...document.querySelectorAll('[data-truth="sponsored"]')].filter((e) => !e.checkVisibility()).length };
  }, batches);
  await page.close();
  return res;
}

async function main() {
  const runs = parseInt(process.argv.find((a) => /^\d+$/.test(a)) || '9', 10);
  const jsonIdx = process.argv.indexOf('--json');
  const out = {};
  for (const withExt of [false, true]) {
    const ctx = await launch(withExt);
    await measureLoad(ctx); // warm-up
    const loads = [];
    for (let i = 0; i < runs; i++) loads.push(await measureLoad(ctx));
    const mut = await measureMutations(ctx);
    let scanStats = null;
    if (withExt) {
      const sw = ctx.serviceWorkers()[0];
      const page = await ctx.newPage();
      await page.goto('https://www.amazon.com/s?k=perf', { waitUntil: 'load' });
      await page.waitForTimeout(4200);
      scanStats = await sw.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) { try { const r = await chrome.tabs.sendMessage(t.id, { type: 'cs:get-state' }); if (r && r.ok) return r.state.perf; } catch (e) {} }
      });
      await page.close();
    }
    const k = (key) => +median(loads.map((l) => l[key])).toFixed(2);
    out[withExt ? 'with' : 'without'] = {
      domContentLoadedMs: k('dcl'), loadMs: k('load'), scriptMs: k('scriptMs'), taskMs: k('taskMs'), layoutMs: k('layoutMs'), styleMs: k('styleMs'),
      jsHeapMB: k('heapMB'), domNodes: k('nodes'), sponsoredHidden: loads[0].hidden, sponsoredTotal: loads[0].total,
      mutationStress: { wallMs: +mut.wallMs.toFixed(0), longestTaskMs: +mut.longestTaskMs.toFixed(1), sponsoredHiddenAfter: mut.hiddenNew },
      engine: scanStats,
    };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 2));
  if (jsonIdx >= 0) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ runs, ...out }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
