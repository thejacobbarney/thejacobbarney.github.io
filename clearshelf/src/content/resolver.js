/*
 * Container resolution and safety.
 *
 * Given a signal, decide WHICH element would be hidden, and whether hiding it is safe.
 *
 * Core rule ("closure"): a container may only be hidden if every product it contains is
 * covered by the evidence. Hiding a wrapper that also holds an unflagged organic result
 * is never allowed, no matter how strong the ad signal is.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});

  /** One product tile. Order matters: the first match walking upward wins. */
  const CARD_SELECTOR = [
    '[data-component-type="s-search-result"]',
    'li.a-carousel-card',
    '.a-carousel-card',
    '.s-result-item[data-asin]:not([data-asin=""])',
    '[data-testid="product-card"]',
  ].join(',');

  /** A self-contained page module (carousel, banner, brand block). */
  const WIDGET_SELECTOR = [
    '.celwidget',
    '[data-cel-widget]',
    '[cel_widget_id]',
    '.s-widget',
    '[data-csa-c-type="widget"]',
    '.a-cardui',
    '.a-carousel-container',
  ].join(',');

  /** Search result cards are the unit of organic content in result grids. */
  const SEARCH_RESULT_SELECTOR = '[data-component-type="s-search-result"]';

  /** Anything that indicates a product (organic or not). */
  const PRODUCT_SELECTOR = 'a[href*="/dp/"], a[href*="/gp/product/"], [data-asin]:not([data-asin=""]), a[href*="/sspa/click"]';

  /** Elements that must never be hidden, nor be swallowed by a hidden container. */
  const PROTECTED_SELF = [
    'html', 'body', 'main', '#a-page', '#search', '#dp', '#dp-container', '#ppd', '#centerCol', '#leftCol', '#rightCol',
    '#buybox', '#desktop_buybox', '#nav-belt', '#navbar', '#nav-main', '#navFooter', '#s-refinements',
    '.s-main-slot', '.s-result-list', '[data-component-type="s-search-results"]', '#search-results', '#pageContent',
  ].join(',');

  const PROTECTED_INNER = [
    '#productTitle', '#add-to-cart-button', '#buy-now-button', '#twotabsearchtextbox', '.s-main-slot', '#nav-belt',
    '#centerCol', '#s-refinements', '[data-component-type="s-search-results"]', '#dp-container', '#addToCart',
    '#buybox', '#desktop_buybox', '#navbar', '#nav-main', 'h1', 'form[action*="/cart/"]',
  ].join(',');

  /** Narrower list for single product tiles, which legitimately contain cart forms and buttons. */
  const PROTECTED_INNER_CARD = [
    '#productTitle', '#add-to-cart-button', '#twotabsearchtextbox', '.s-main-slot', '#nav-belt', '#s-refinements',
    '[data-component-type="s-search-results"]', '#dp-container',
  ].join(',');

  const LIMITS = Object.freeze({
    maxWrapperLevels: 4,
    maxWidgetClimb: 3,
    maxWidgetCards: 60,
    maxWidgetLinks: 160,
    maxRepeatedItemLevels: 10,
    maxInferLevels: 8,
    maxInferProducts: 40,
  });

  function isProtectedSelf(el) {
    return !!(el.matches && el.matches(PROTECTED_SELF));
  }

  function containsProtected(el, card) {
    return !!el.querySelector(card ? PROTECTED_INNER_CARD : PROTECTED_INNER);
  }

  const ASIN_IN_HREF = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;

  /** True when the element holds at most a few distinct products, i.e. it is plausibly one tile. */
  function looksLikeSingleProduct(el) {
    const asins = new Set();
    const a0 = el.getAttribute('data-asin');
    if (a0) asins.add(a0);
    let n = 0;
    for (const n1 of el.querySelectorAll('[data-asin]:not([data-asin=""]), a[href*="/dp/"]')) {
      if (++n > 60) return false;
      const a = n1.getAttribute('data-asin');
      if (a) asins.add(a);
      else {
        const m = ASIN_IN_HREF.exec(n1.getAttribute('href') || '');
        if (m) asins.add(m[1]);
      }
      if (asins.size > 3) return false;
    }
    return true;
  }

  function outermostSameAsin(card) {
    const asin = card.getAttribute('data-asin');
    if (!asin) return card;
    let p = card.parentElement && card.parentElement.closest('[data-asin]:not([data-asin=""])');
    while (p && p.getAttribute('data-asin') === asin && !isProtectedSelf(p)) {
      card = p;
      p = card.parentElement && card.parentElement.closest('[data-asin]:not([data-asin=""])');
    }
    return card;
  }

  /**
   * Nearest product tile. Known tile selectors win; if Amazon renames its classes, a data-asin
   * element that looks like a single product is accepted as a fallback.
   */
  function closestCard(el) {
    const known = el.closest(CARD_SELECTOR);
    if (known) return outermostSameAsin(known);
    const byAsin = el.closest('[data-asin]:not([data-asin=""])');
    if (byAsin && !isProtectedSelf(byAsin)) {
      const outer = outermostSameAsin(byAsin);
      if (!isProtectedSelf(outer) && looksLikeSingleProduct(outer)) return outer;
    }
    return null;
  }

  function closestWidget(el) {
    const w = el.closest(WIDGET_SELECTOR);
    return w && !isProtectedSelf(w) ? w : null;
  }

  /** Inert children do not count as "other content": scripts, hidden nodes, empty spacers. */
  function isInert(el) {
    if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(el.tagName)) return true;
    if (el.hasAttribute('hidden')) return true;
    if (el.querySelector('a, img, video, iframe, button, input, svg, picture, canvas')) return false;
    return !(el.textContent || '').trim();
  }

  /**
   * Ad furniture: the small "Sponsored" / "Ad feedback" chrome that travels with an ad. A wrapper
   * holding an ad plus its own furniture is still "only the ad".
   */
  function isAdFurniture(el) {
    if (el.querySelector('img, video, iframe, picture, canvas, [data-asin]:not([data-asin=""]), a[href*="/dp/"]')) return false;
    const text = (el.textContent || '').trim();
    if (!text) return false;
    if (text.length > 40) return false;
    if (CS.vocab.matchLabelText(text)) return true;
    return !!CS.vocab.matchLabelAttr(el.getAttribute('aria-label') || '') || /^ad feedback$/i.test(text);
  }

  /** Parent whose only meaningful child is `child` (ignoring inert nodes and ad furniture). */
  function ownsOnly(parent, child) {
    for (const c of parent.children) {
      if (c !== child && !isInert(c) && !isAdFurniture(c)) return false;
    }
    // Text nodes directly in the parent also count as content.
    for (const n of parent.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) return false;
    }
    return true;
  }

  /** Climbs through single-child wrapper divs so no empty padded shell is left behind. */
  function collapseWrappers(el) {
    let cur = el;
    for (let i = 0; i < LIMITS.maxWrapperLevels; i++) {
      const p = cur.parentElement;
      if (!p || isProtectedSelf(p) || p.matches(CARD_SELECTOR)) break;
      if (!ownsOnly(p, cur)) break;
      if (containsProtected(p)) break;
      cur = p;
    }
    return cur;
  }

  function productEls(el) {
    return Array.from(el.querySelectorAll(PRODUCT_SELECTOR));
  }

  /**
   * Looks for a repeated sibling item (grid/list tile) when there is no known card selector.
   * Requires 3+ siblings sharing tag and class, containing an image and a product link.
   */
  function repeatedItem(el) {
    let cur = el;
    for (let i = 0; i < LIMITS.maxRepeatedItemLevels && cur && cur.parentElement; i++) {
      const parent = cur.parentElement;
      if (isProtectedSelf(cur)) return null;
      if (cur.className && typeof cur.className === 'string') {
        let same = 0;
        for (const s of parent.children) {
          if (s.tagName === cur.tagName && s.className === cur.className) same++;
        }
        if (same >= 3 && cur.querySelector('img, picture') && cur.querySelector('a[href]')) return cur;
      }
      cur = parent;
    }
    return null;
  }

  /**
   * Last-resort module inference for label signals when no card or widget hook exists (for
   * example after Amazon renames its widget classes). The module is the smallest ancestor of
   * the label that contains product content, provided the label comes before every product in
   * it (a heading-style label) and the module is small. The engine additionally demands a
   * second, independent kind of evidence before acting on an inferred module.
   */
  function inferModule(labelEl) {
    let cur = labelEl;
    for (let i = 0; i < LIMITS.maxInferLevels && cur.parentElement; i++) {
      cur = cur.parentElement;
      if (isProtectedSelf(cur)) return null;
      const prods = productEls(cur);
      if (prods.length === 0) continue;
      if (prods.length > LIMITS.maxInferProducts) return null;
      for (const p of prods) {
        if (!(labelEl.compareDocumentPosition(p) & 4 /* FOLLOWING */)) return null;
      }
      return cur;
    }
    return null;
  }

  /**
   * Maps a signal to its initial ("unit0") container before any climbing.
   * @returns {{el:Element, scope:'card'|'widget'|'bare'}|null}
   */
  function resolveUnit0(signal) {
    const el = signal.el;
    if (signal.selfUnit) {
      // The signal element is itself the candidate module (for example an ad widget id).
      const card = closestCard(el);
      if (card) return { el: card, scope: 'card' };
      return isProtectedSelf(el) ? null : { el, scope: 'widget' };
    }
    const card = closestCard(el);
    if (card) return { el: card, scope: 'card' };
    const widget = closestWidget(el);
    if (widget) return { el: widget, scope: 'widget' };
    const rep = repeatedItem(el);
    if (rep) return { el: rep, scope: 'card' };
    // Self-contained ad artefacts (ad iframes, class markers) can stand alone. Labels and
    // links cannot: without a card or module around them there is nothing safe to hide.
    if (signal.family === 'adframe' || signal.family === 'class') {
      if (isProtectedSelf(el)) return null;
      return { el, scope: 'bare' };
    }
    if (signal.family === 'label') {
      const m = inferModule(el);
      if (m) return { el: m, scope: 'widget', inferred: true };
    }
    return null;
  }

  /**
   * Is it safe to hide `el`? Returns {ok, reason}. `flagged` is the set of elements the engine
   * has already decided to hide, so the nested-ad case (flagged cards inside a module) works.
   */
  function checkSafety(el, scope, flagged) {
    if (!el || !el.isConnected) return { ok: false, reason: 'detached' };
    if (isProtectedSelf(el)) return { ok: false, reason: 'protected-element' };
    if (containsProtected(el, scope === 'card')) return { ok: false, reason: 'contains-protected-landmark' };
    if (el.closest('[' + CS.ATTR.allow + ']')) return { ok: false, reason: 'allowlisted' };

    if (scope !== 'card') {
      // Organic search results are never swallowed by a module-level hide.
      for (const r of el.querySelectorAll(SEARCH_RESULT_SELECTOR)) {
        if (!flagged.has(r) && !isInsideFlagged(r, flagged)) return { ok: false, reason: 'contains-unflagged-search-result' };
      }
      if (el.querySelectorAll(CARD_SELECTOR).length > LIMITS.maxWidgetCards) return { ok: false, reason: 'too-many-cards' };
      if (el.querySelectorAll('a[href]').length > LIMITS.maxWidgetLinks) return { ok: false, reason: 'too-many-links' };
    } else {
      // A card must not contain a second, different card that is not flagged.
      for (const inner of el.querySelectorAll(CARD_SELECTOR)) {
        if (inner !== el && !flagged.has(inner)) return { ok: false, reason: 'contains-unflagged-card' };
      }
    }
    return { ok: true, reason: 'safe' };
  }

  function isInsideFlagged(el, flagged) {
    for (let p = el.parentElement; p; p = p.parentElement) if (flagged.has(p)) return true;
    return false;
  }

  /**
   * Climbs from a widget to an enclosing widget when the parent holds nothing else of value
   * (closure principle), so header-only fragments do not leave their carousels behind.
   */
  function climbWidget(start, flagged) {
    let cur = start;
    for (let i = 0; i < LIMITS.maxWidgetClimb; i++) {
      const p = cur.parentElement && cur.parentElement.closest(WIDGET_SELECTOR);
      if (!p || isProtectedSelf(p)) break;
      if (!checkSafety(p, 'widget', flagged).ok) break;
      // Everything product-like in the parent must already live inside the current module.
      const outside = productEls(p).some((n) => !cur.contains(n));
      if (outside) break;
      cur = p;
    }
    return cur;
  }

  /**
   * Final container for a unit0, applying climbing. Returns the element to hide.
   */
  function finalContainer(unit0, flagged) {
    if (unit0.scope === 'widget') {
      return collapseWrappers(climbWidget(unit0.el, flagged));
    }
    if (unit0.scope === 'card') {
      return collapseWrappers(unit0.el);
    }
    return collapseWrappers(unit0.el);
  }

  CS.resolver = {
    CARD_SELECTOR,
    WIDGET_SELECTOR,
    SEARCH_RESULT_SELECTOR,
    PRODUCT_SELECTOR,
    PROTECTED_SELF,
    PROTECTED_INNER,
    PROTECTED_INNER_CARD,
    LIMITS,
    isProtectedSelf,
    containsProtected,
    closestCard,
    closestWidget,
    collapseWrappers,
    repeatedItem,
    inferModule,
    isAdFurniture,
    resolveUnit0,
    checkSafety,
    finalContainer,
    isInsideFlagged,
  };

  if (typeof module === 'object' && module.exports) module.exports = CS.resolver;
})(typeof globalThis !== 'undefined' ? globalThis : self);
