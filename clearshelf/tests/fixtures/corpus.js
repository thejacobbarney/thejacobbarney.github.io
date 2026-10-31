'use strict';
// Seeded random page corpus with ground truth, plus the "layout drift" transforms.
const M = require('./markup.js');

const SPONSORED_PRODUCT_VARIANTS = ['modern', 'modern', 'modern', 'legacy', 'textonly', 'glyph', 'linkonly', 'ariaonly', 'spanish', 'german'];
const ORGANIC_VARIANTS = ['plain', 'plain', 'plain', 'plain', 'adversarial', 'badges', 'deal'];

function wrapSometimes(ctx, html) {
  const r = ctx.rng();
  if (r < 0.15) return `<div class="sg-col-inner">${html}</div>`;
  if (r < 0.22) return `<div class="a-section"><div class="a-row">${html}</div></div>`;
  return html;
}

function searchPageFor(ctx) {
  const parts = [];
  if (ctx.rng() < 0.6) parts.push(M.brandBanner(ctx));
  const n = 20 + Math.floor(ctx.rng() * 28);
  const sponsoredRate = 0.1 + ctx.rng() * 0.15;
  const videoAt = ctx.rng() < 0.3 ? 3 + Math.floor(ctx.rng() * 10) : -1;
  const carAt = ctx.rng() < 0.4 ? 5 + Math.floor(ctx.rng() * 12) : -1;
  for (let i = 1; i <= n; i++) {
    const sponsored = ctx.rng() < sponsoredRate;
    parts.push(wrapSometimes(ctx, sponsored
      ? M.searchCard(ctx, 'sponsored', M.pick(ctx, SPONSORED_PRODUCT_VARIANTS), i)
      : M.searchCard(ctx, 'organic', M.pick(ctx, ORGANIC_VARIANTS), i)));
    if (i === videoAt) parts.push(M.videoAd(ctx));
    if (i === carAt) parts.push(M.searchCarouselBetween(ctx));
  }
  return { html: M.searchPage(parts), pageType: 'search', path: '/s?k=test' };
}

function productPageFor(ctx) {
  const widgets = [];
  const n = 2 + Math.floor(ctx.rng() * 4);
  for (let i = 0; i < n; i++) {
    const r = ctx.rng();
    if (r < 0.3) widgets.push(M.carousel(ctx, 'heading', { id: 'sp_detail' + (i || ''), plainLinks: ctx.rng() < 0.5 }));
    else if (r < 0.45) widgets.push(M.carousel(ctx, 'perCard', { id: 'adx_' + i }));
    else if (r < 0.55) widgets.push(M.iframeBanner('desktop-ad-' + i));
    else widgets.push(M.carousel(ctx, 'organic', { id: 'sims-' + i + '_feature_div', heading: M.pick(ctx, ['Customers who viewed this item also viewed', 'Frequently bought together', 'Related to items you viewed']) }));
  }
  return { html: M.productPage(ctx, widgets), pageType: 'product', path: '/dp/B09B8V1LZ3' };
}

function homePageFor(ctx) {
  const parts = [];
  const n = 8 + Math.floor(ctx.rng() * 10);
  for (let i = 0; i < n; i++) parts.push(M.homeCard(ctx, ctx.rng() < 0.2));
  if (ctx.rng() < 0.5) parts.push(M.iframeBanner('desktop-ad-atf'));
  return { html: M.homePage(parts), pageType: 'home', path: '/' };
}

function generatePage(seed) {
  const ctx = M.makeCtx(seed);
  const r = ctx.rng();
  if (r < 0.6) return searchPageFor(ctx);
  if (r < 0.8) return productPageFor(ctx);
  return homePageFor(ctx);
}

// ------------------------------------------------------------------ drift transforms

function hashToken(t) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'c' + (h >>> 0).toString(36);
}

/** Simulates Amazon renaming every CSS class. data-* attributes, ids, hrefs and text are untouched. */
function scrambleClasses(html) {
  return html.replace(/\sclass="([^"]*)"/g, (m, v) => ' class="' + v.split(/\s+/).filter(Boolean).map(hashToken).join(' ') + '"');
}

/** Worse: classes scrambled AND the semantic data attributes and widget ids removed. Only text, asin, hrefs and aria survive. */
function hostile(html) {
  return scrambleClasses(html)
    .replace(/\sdata-component-type="[^"]*"/g, '')
    .replace(/\sdata-cel-widget="[^"]*"/g, '')
    .replace(/\sid="(?:sp_detail\d*|adx_\d+|desktop-ad-[^"]*|sims-[^"]*)"/g, '');
}

module.exports = { generatePage, scrambleClasses, hostile, hashToken };
