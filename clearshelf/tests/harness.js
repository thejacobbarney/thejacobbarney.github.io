/*
 * Test harness: runs the real engine, in real Chromium, against fixture HTML and scores the
 * outcome against the data-truth ground truth baked into the fixtures.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SRC = path.join(__dirname, '..', 'src');
const ENGINE_FILES = [
  'shared/constants.js', 'content/vocab.js', 'content/signals.js', 'content/resolver.js', 'content/scoring.js', 'content/engine.js',
].map((f) => path.join(SRC, f));

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch();
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise; await b.close(); browserPromise = null; }
}

/**
 * Loads html in a fresh page and returns { page, engine helpers }.
 * The page is served from https://www.amazon.com/ via request interception so location-based
 * logic sees a realistic origin without any network access.
 */
async function openFixture(html, { path: urlPath = '/s?k=test' } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = 'https://www.amazon.com' + urlPath;
  await page.route('**/*', (route) => {
    if (route.request().url() === url) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(url);
  for (const f of ENGINE_FILES) await page.addScriptTag({ path: f });
  await page.addStyleTag({ path: path.join(SRC, 'content/content.css') });
  return { page, context, close: () => context.close() };
}

/** Runs one full scan with the given settings and returns scoring info per ground-truth unit. */
async function runEngine(html, { settings = {}, pageType = 'search', path: urlPath } = {}) {
  const fx = await openFixture(html, { path: urlPath });
  try {
    const out = await fx.page.evaluate(({ settings, pageType }) => {
      const CS = globalThis.CS;
      const engine = CS.createEngine({ settings, pageType });
      // Mirror the controller: CSS attribute gate so display state matches production.
      document.documentElement.setAttribute('data-cs-on', '1');
      engine.scan(document.documentElement);
      const units = [...document.querySelectorAll('[data-truth]')].map((el) => ({
        truth: el.getAttribute('data-truth'),
        variant: el.getAttribute('data-variant') || '',
        hidden: !!el.closest('[data-cs-hidden]'),
        partiallyHidden: !!el.querySelector('[data-cs-hidden]'),
        displayNone: !el.checkVisibility(),
        kind: (el.closest('[data-cs-hidden]') || el).getAttribute('data-cs-kind') || '',
      }));
      const protectedIds = ['navbar', 'nav-belt', 'twotabsearchtextbox', 's-refinements', 'search', 'a-page', 'productTitle', 'add-to-cart-button', 'buybox', 'navFooter', 'dp', 'ppd', 'centerCol'];
      const protectedHidden = protectedIds.filter((id) => {
        const el = document.getElementById(id);
        return el && (el.closest('[data-cs-hidden]') || el.querySelector('[data-cs-hidden]') && el.hasAttribute('data-cs-hidden'));
      });
      return { units, protectedHidden, report: engine.report() };
    }, { settings, pageType });
    return out;
  } finally {
    await fx.close();
  }
}

function score(units) {
  let tp = 0, fp = 0, fn = 0, tn = 0, collateral = 0;
  const misses = [];
  const falsePos = [];
  for (const u of units) {
    if (u.truth === 'sponsored') {
      if (u.hidden) tp++;
      else { fn++; misses.push(u.variant); }
    } else {
      if (u.hidden || u.partiallyHidden) { fp++; falsePos.push(u.variant); }
      else tn++;
    }
  }
  const organic = fp + tn;
  const sponsored = tp + fn;
  return {
    tp, fp, fn, tn, sponsored, organic,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: sponsored ? tp / sponsored : 1,
    organicPreserved: organic ? tn / organic : 1,
    misses, falsePos, collateral,
  };
}

module.exports = { openFixture, runEngine, score, closeBrowser, ENGINE_FILES, SRC };
