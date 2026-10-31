/*
 * Synthetic Amazon-style markup factory.
 *
 * IMPORTANT: these are reconstructions from known Amazon markup patterns, NOT captured pages.
 * They exist to exercise the engine against realistic structure and drift. Passing them does
 * not prove the extension works on live Amazon; see docs/TESTING.md.
 *
 * Ground truth lives in `data-truth="sponsored|organic"` on the outermost unit of each item.
 * The engine must never read it (enforced by tests/unit/no-truth-leak.test.js).
 */
'use strict';

// ------------------------------------------------------------------ deterministic helpers

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function makeAsin(rng) {
  let s = 'B0';
  for (let i = 0; i < 8; i++) s += ALNUM[Math.floor(rng() * ALNUM.length)];
  return s;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const TITLES = [
  'Anker USB C Cable 10ft Braided Fast Charging',
  'Echo Dot (5th Gen) Smart Speaker with Alexa',
  'Stainless Steel Water Bottle 32 oz Insulated',
  'Logitech MX Master 3S Wireless Mouse',
  'Instant Pot Duo 7-in-1 Electric Pressure Cooker',
  'Hanes Mens Crew T-Shirt 6 Pack',
  'Neutrogena Hydro Boost Water Gel Moisturizer',
  'Fire TV Stick 4K Streaming Device',
  'Bluetooth Mechanical Keyboard Compact 75%',
  'Cuisinart 12-Cup Coffee Maker Programmable',
  'Yoga Mat Non Slip Extra Thick 6mm',
  'LED Desk Lamp with USB Charging Port',
  'Samsonite Carry-On Hardside Luggage',
  'Crayola Colored Pencils 64 Count',
  'Philips Sonicare Electric Toothbrush',
  'Ring Video Doorbell Wired',
  'Wireless Earbuds Noise Cancelling IPX7',
  'Dewalt 20V MAX Cordless Drill Kit',
  'KitchenAid Stand Mixer Artisan 5 Quart',
  'Bose QuietComfort Headphones',
];

// Titles that merely contain ad-ish words. These are ORGANIC and must survive.
const ADVERSARIAL_TITLES = [
  'Ad Hoc Wireless Networking: A Practical Handbook (Paperback)',
  'The Sponsored Content Playbook: A Marketer’s Guide',
  'Sponsored by Nobody: A Novel',
  'Sponsored',
  'AD&D Player’s Handbook, 5th Edition',
  'Ad Blocker Pro Router with Parental Controls',
  'Advertisement Design and Layout Principles',
  'Ads Mavens: Facebook Advertising Made Simple',
];

function makeCtx(seed, opts = {}) {
  const rng = mulberry32(seed);
  return { rng, seed, opts, n: 0 };
}

function pick(ctx, arr) {
  return arr[Math.floor(ctx.rng() * arr.length)];
}

function img() {
  return '<img class="s-image" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">';
}

// ------------------------------------------------------------------ search result cards

const SEARCH_LABEL_VARIANTS = {
  // Current layout: puis label wrapper, info icon link, sspa click-through
  modern: (label) =>
    `<div class="a-row a-spacing-micro"><span class="puis-label-popover puis-sponsored-label-text"><span class="puis-label-popover-default"><span class="a-color-secondary">${label}</span></span><a class="puis-sponsored-label-info-icon" href="javascript:void(0)" aria-label="View Sponsored information or leave ad feedback"><i class="a-icon a-icon-popover"></i></a></span></div>`,
  // Older layout: s-sponsored label classes
  legacy: (label) =>
    `<div class="a-row a-spacing-micro"><span class="s-label-popover-default"><span class="a-size-mini a-color-secondary s-sponsored-label-text">${label}</span></span></div>`,
  // Only the visible word; every Amazon-specific class is gone
  textonly: (label) => `<div class="x1"><span class="x2">${label}</span></div>`,
  // Visible word nested under a few wrappers with an info glyph
  glyph: (label) => `<div class="x1"><div class="x2"><span class="x3">${label} ⓘ</span></div></div>`,
};

function titleBlock(title, href, ariaPrefix) {
  const aria = ariaPrefix ? `Sponsored Ad – ${title}` : title;
  return `<div data-cy="title-recipe" class="a-section a-spacing-none a-spacing-top-small s-title-instructions-style"><a class="a-link-normal s-line-clamp-2 s-link-style a-text-normal" href="${href}"><h2 aria-label="${esc(aria)}" class="a-size-base-plus a-spacing-none a-color-base a-text-normal"><span>${esc(title)}</span></h2></a></div>`;
}

function priceBlock(ctx) {
  const p = (5 + Math.floor(ctx.rng() * 150)) + '.99';
  return `<div data-cy="price-recipe"><span class="a-price"><span class="a-offscreen">$${p}</span><span aria-hidden="true">$${p}</span></span><form action="/cart/add-to-cart/ref=sr_atc" method="post"><button class="a-button-text" type="submit">Add to cart</button></form></div>`;
}

/**
 * One search result card.
 * kind: 'organic' | 'sponsored'
 * variant (sponsored): modern | legacy | textonly | glyph | linkonly | ariaonly | weakad | spanish | german
 * variant (organic): plain | adversarial | badges | deal
 */
function searchCard(ctx, kind, variant, index) {
  const a = makeAsin(ctx.rng);
  const truth = kind === 'sponsored' ? 'sponsored' : 'organic';
  let title = pick(ctx, TITLES);
  let href = `/Some-Product/dp/${a}/ref=sr_1_${index}?keywords=x&qid=1&sr=8-${index}`;
  let label = '';
  let cardClass = 's-result-item s-asin sg-col-4-of-24 sg-col-4-of-12 sg-col s-widget-spacing-small';
  let inner = '';
  let ariaPrefix = false;

  if (kind === 'organic') {
    if (variant === 'adversarial') title = pick(ctx, ADVERSARIAL_TITLES);
    if (variant === 'badges') inner += '<div class="a-row"><span class="a-badge-text">Best Seller</span><span class="a-badge-text">Amazon’s Choice</span></div>';
    if (variant === 'deal') inner += '<div class="a-row"><span class="a-badge-text">Limited time deal</span></div>';
  } else {
    switch (variant) {
      case 'modern':
        href = `/sspa/click?ie=UTF8&spc=MTo2&url=%2Fdp%2F${a}%2Fref%3Dsspa_dk_detail_0&sp_csd=d2lkZ2V0TmFtZT1zcF9hdGY&sp_atk=abc`;
        label = SEARCH_LABEL_VARIANTS.modern('Sponsored');
        break;
      case 'legacy':
        cardClass += ' AdHolder';
        href = `/gp/slredirect/picassoRedirect.html/ref=pa_sp_atf_aps_sr_pg1_1?ie=UTF8&adId=A1&url=%2Fdp%2F${a}`;
        label = SEARCH_LABEL_VARIANTS.legacy('Sponsored');
        inner += '<div data-component-type="sp-sponsored-result" data-ad-id="x"></div>';
        break;
      case 'textonly':
        label = SEARCH_LABEL_VARIANTS.textonly('Sponsored');
        break;
      case 'glyph':
        label = SEARCH_LABEL_VARIANTS.glyph('Sponsored');
        break;
      case 'linkonly':
        href = `/sspa/click?ie=UTF8&spc=MTo2&url=%2Fdp%2F${a}&sp_csd=d2lkZ2V0TmFtZT1zcF9hdGY`;
        break;
      case 'ariaonly':
        ariaPrefix = true;
        break;
      case 'weakad':
        label = SEARCH_LABEL_VARIANTS.textonly('Ad');
        break;
      case 'spanish':
        label = SEARCH_LABEL_VARIANTS.textonly('Patrocinado');
        break;
      case 'german':
        label = SEARCH_LABEL_VARIANTS.textonly('Anzeige');
        break;
      default:
        throw new Error('unknown sponsored variant ' + variant);
    }
  }

  return (
    `<div role="listitem" data-asin="${a}" data-index="${index}" data-component-type="s-search-result" class="${cardClass}" data-truth="${truth}" data-variant="${variant}">` +
    `<div class="sg-col-inner"><div class="a-section a-spacing-base">` +
    `<div class="s-product-image-container"><span><a class="a-link-normal s-no-outline" href="${href}">${img()}</a></span></div>` +
    `<div class="a-section a-spacing-small puis-padding-left-small">${label}${titleBlock(title, href, ariaPrefix)}${inner}${priceBlock(ctx)}</div>` +
    `</div></div></div>`
  );
}

// ------------------------------------------------------------------ carousels

function carouselCard(ctx, sponsored, labelHtml, plainLinks) {
  const a = makeAsin(ctx.rng);
  const href = sponsored && !plainLinks ? `/sspa/click?ie=UTF8&url=%2Fdp%2F${a}&sp_csd=abc` : `/dp/${a}/ref=pd_sim_1`;
  return (
    `<li class="a-carousel-card" data-asin="${a}" aria-setsize="8"><div class="a-section"><a class="a-link-normal" href="${href}">${img()}</a>` +
    `<a class="a-link-normal" href="${href}"><span class="a-size-base">${esc(pick(ctx, TITLES))}</span></a>${labelHtml || ''}</div></li>`
  );
}

/**
 * A carousel widget.
 * mode: 'heading' (label only in heading), 'perCard' (label in every card), 'organic'
 */
function carousel(ctx, mode, opts = {}) {
  const count = opts.count || 6;
  const id = opts.id || (mode === 'organic' ? 'sims-consolidated-1_feature_div' : 'sp_detail');
  const heading = opts.heading || (mode === 'organic' ? 'Customers who viewed this item also viewed' : 'Products related to this item');
  const truth = mode === 'organic' ? 'organic' : 'sponsored';
  let headerLabel = '';
  if (mode === 'heading') headerLabel = `<span class="a-color-secondary">Sponsored</span><a href="javascript:void(0)" aria-label="View Sponsored information or leave ad feedback">i</a>`;
  let cards = '';
  for (let i = 0; i < count; i++) {
    const per = mode === 'perCard' ? '<span class="a-size-mini a-color-secondary">Sponsored</span>' : '';
    cards += carouselCard(ctx, mode !== 'organic', per, !!opts.plainLinks);
  }
  const widgetAttr = opts.noWidgetAttrs ? '' : ` id="${id}" data-cel-widget="${id}"`;
  return (
    `<div class="celwidget a-section a-spacing-large"${widgetAttr} data-truth="${truth}" data-variant="carousel-${mode}${opts.plainLinks ? '-plain' : ''}">` +
    `<div class="a-carousel-container a-carousel-initialized"><div class="a-row a-carousel-header-row"><h2 class="a-carousel-heading">${esc(heading)}</h2>${headerLabel}</div>` +
    `<div class="a-carousel-viewport"><ol class="a-carousel" role="list">${cards}</ol></div></div></div>`
  );
}

// ------------------------------------------------------------------ brand / video / banners

function brandBanner(ctx, opts = {}) {
  const tiles = [0, 1, 2].map(() => carouselCard(ctx, true, '')).join('');
  const brand = pick(ctx, ['Anker', 'Logitech', 'Cuisinart', 'Philips']);
  const label = opts.labelless ? '' : '<span class="a-size-mini a-color-secondary">Sponsored</span>';
  return (
    `<div class="s-widget s-flex-geom celwidget" data-component-type="s-ads-metrics" data-cel-widget="search_result_0" data-truth="sponsored" data-variant="brand">` +
    `<div class="sbx-container"><div class="a-row">${label}</div>` +
    `<a href="/stores/page/ABC123?ref_=sbx_be_s_sparkle_mcd_0" class="a-link-normal"><img alt="${brand}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="80" height="20"></a>` +
    `<h2 class="a-size-medium">${brand}: built to last</h2><ol class="a-carousel">${tiles}</ol></div></div>`
  );
}

function videoAd(ctx) {
  const a = makeAsin(ctx.rng);
  return (
    `<div class="s-widget celwidget" data-cel-widget="MAIN-VIDEO_SINGLE_PRODUCT-sbv-1" data-component-type="sbv-video-single-product" data-truth="sponsored" data-variant="video">` +
    `<div class="sbv-container"><span class="a-color-secondary">Sponsored</span><video class="sbv-player" muted playsinline></video>` +
    `<a href="/dp/${a}/ref=sbv_sr_1" class="a-link-normal">${img()}</a><h2>${esc(pick(ctx, TITLES))}</h2></div></div>`
  );
}

function searchCarouselBetween(ctx) {
  // A "Sponsored products related to your search" row dropped between organic results.
  const cards = [0, 1, 2, 3].map(() => carouselCard(ctx, true, '')).join('');
  return (
    `<div class="s-widget celwidget" data-cel-widget="MAIN-ADS-CAROUSEL" data-truth="sponsored" data-variant="search-carousel">` +
    `<div class="a-carousel-container"><div class="a-row"><h2 class="a-carousel-heading">Sponsored</h2></div><ol class="a-carousel">${cards}</ol></div></div>`
  );
}

function iframeBanner(id = 'desktop-ad-btf', opts = {}) {
  const feedback = opts.noFeedback ? '' : '<a class="ad-feedback-link" href="#" aria-label="Ad feedback">Ad feedback</a>';
  return (
    `<div id="${id}" class="celwidget a-section" data-cel-widget="${id}" data-truth="sponsored" data-variant="iframe-banner">` +
    `<iframe title="Advertisement" src="https://c.amazon-adsystem.com/aax2/getads?slot=x" width="728" height="90"></iframe>${feedback}</div>`
  );
}

function homeCard(ctx, sponsored) {
  const a = makeAsin(ctx.rng);
  const label = sponsored ? '<span class="a-size-mini a-color-secondary">Sponsored</span>' : '';
  const href = sponsored ? `/gp/slredirect/picassoRedirect.html?url=%2Fdp%2F${a}` : `/dp/${a}/ref=gw_pick`;
  return (
    `<div class="a-cardui celwidget" data-cel-widget="desktop-grid-${a}" data-truth="${sponsored ? 'sponsored' : 'organic'}" data-variant="home-card">` +
    `<h2 class="a-size-large">${sponsored ? esc(pick(ctx, TITLES)) : 'Top picks for you'}</h2>${label}` +
    `<a href="${href}" class="a-link-normal">${img()}</a></div>`
  );
}

// ------------------------------------------------------------------ page shells

const NAV = `<header id="navbar"><div id="nav-belt"><input id="twotabsearchtextbox" type="text" aria-label="Search Amazon"><a href="/cart">Cart</a></div></header>`;
const FOOTER = `<footer id="navFooter"><a href="/gp/help/customer/display.html">Interest-Based Ads</a><span>Advertisement preferences</span><a href="#">Sponsored</a></footer>`;

function page(title, body, extraHead = '') {
  return `<!doctype html><html lang="en" class="a-js"><head><meta charset="utf-8"><title>${esc(title)}</title>${extraHead}</head><body class="a-m-us">${NAV}${body}${FOOTER}</body></html>`;
}

function searchPage(parts) {
  return page('Amazon.com : test', `<div id="a-page"><div id="search"><div id="s-refinements"><span>Brands</span></div><div class="s-main-slot s-result-list s-search-results sg-row" data-component-type="s-search-results">${parts.join('')}</div></div></div>`);
}

function productPage(ctx, widgetsHtml) {
  const asin = makeAsin(ctx.rng);
  return page(
    'Product',
    `<div id="a-page"><div id="dp" class="a-container"><div id="dp-container" data-asin="${asin}"><div id="ppd"><div id="centerCol"><h1 id="title"><span id="productTitle">Echo Dot (5th Gen)</span></h1><div id="buybox"><form id="addToCart" action="/gp/product/handle-buy-box"><input id="add-to-cart-button" type="submit" value="Add to Cart"></form></div></div></div>` +
      `<div id="dp-widgets">${widgetsHtml.join('')}</div></div></div></div>`
  );
}

function homePage(parts) {
  return page('Amazon.com. Spend less.', `<div id="a-page"><div id="pageContent"><div class="a-cardui-grid">${parts.join('')}</div></div></div>`);
}

module.exports = {
  mulberry32, makeCtx, makeAsin, pick, esc, TITLES, ADVERSARIAL_TITLES,
  searchCard, carousel, carouselCard, brandBanner, videoAd, searchCarouselBetween, iframeBanner, homeCard,
  searchPage, productPage, homePage, page,
};
