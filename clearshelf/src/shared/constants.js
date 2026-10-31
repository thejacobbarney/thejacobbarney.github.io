/*
 * Clearshelf shared constants, defaults, and settings helpers.
 *
 * Loaded by: content scripts, the service worker (importScripts), the popup,
 * and Node unit tests. Everything hangs off one namespace, CS, so the files can
 * be plain classic scripts with no bundler.
 */
(function (root) {
  'use strict';

  const CS = (root.CS = root.CS || {});

  CS.VERSION = '1.0.0';

  /** Attribute names written onto page elements. Prefixed to avoid collisions. */
  CS.ATTR = Object.freeze({
    hidden: 'data-cs-hidden',
    kind: 'data-cs-kind',
    conf: 'data-cs-conf',
    why: 'data-cs-why',
    allow: 'data-cs-allow',
    considered: 'data-cs-considered',
    rootOn: 'data-cs-on',
    rootInstant: 'data-cs-instant',
    rootDebug: 'data-cs-debug',
  });

  /** Messages exchanged between popup, content scripts and the service worker. */
  CS.MSG = Object.freeze({
    stats: 'cs:stats',
    getState: 'cs:get-state',
    getDiagnostics: 'cs:get-diagnostics',
    rescan: 'cs:rescan',
  });

  CS.STORAGE = Object.freeze({
    settings: 'cs.settings',
    lifetime: 'cs.lifetime',
    session: 'cs.session', // chrome.storage.session
  });

  /**
   * Placement kinds. A detected container is classified into exactly one kind and
   * the user can switch each kind on or off independently.
   */
  CS.KINDS = Object.freeze([
    { id: 'product', label: 'Sponsored products', hint: 'Ad listings mixed into search and category results' },
    { id: 'brand', label: 'Brand banners', hint: 'Sponsored brand headlines and store spotlights' },
    { id: 'video', label: 'Video ads', hint: 'Sponsored video placements' },
    { id: 'carousel', label: 'Sponsored carousels', hint: 'Ad rows such as "Sponsored products related to this item"' },
    { id: 'banner', label: 'Display banners', hint: 'Banner and iframe ad slots on the homepage and product pages' },
    { id: 'recommendation', label: 'Promoted recommendations', hint: 'Sponsored tiles inside recommendation grids' },
    { id: 'other', label: 'Other paid placements', hint: 'Anything else clearly labelled as sponsored' },
  ]);

  CS.PAGE_TYPES = Object.freeze([
    { id: 'home', label: 'Homepage' },
    { id: 'search', label: 'Search results' },
    { id: 'category', label: 'Category and best-seller pages' },
    { id: 'product', label: 'Product pages' },
    { id: 'other', label: 'Other pages (cart, lists, etc.)' },
  ]);

  /**
   * Detection modes.
   *  threshold   - minimum combined confidence to hide
   *  minFamilies - minimum number of independent evidence families
   */
  CS.MODES = Object.freeze({
    strict: { id: 'strict', label: 'Strict', threshold: 0.95, minFamilies: 2, hint: 'Needs two independent kinds of evidence. Fewest mistakes, may miss some ads.' },
    balanced: { id: 'balanced', label: 'Balanced', threshold: 0.8, minFamilies: 1, hint: 'One strong indicator, such as the visible "Sponsored" label, is enough.' },
    aggressive: { id: 'aggressive', label: 'Aggressive', threshold: 0.5, minFamilies: 1, hint: 'Also acts on weaker hints. Catches more, higher risk of false positives.' },
  });

  /**
   * Domain registry. Only entries with status "active" are wired into the manifest.
   * To add a region: add its host to manifest.json (content_scripts.matches and
   * host_permissions), add the entry here, and add its label vocabulary in
   * content/vocab.js if the language is new. See README "Adding a region".
   */
  CS.DOMAINS = Object.freeze([
    { host: 'amazon.com', label: 'Amazon United States', status: 'active', lang: 'en' },
    { host: 'amazon.ca', label: 'Amazon Canada', status: 'planned', lang: 'en' },
    { host: 'amazon.co.uk', label: 'Amazon United Kingdom', status: 'planned', lang: 'en' },
    { host: 'amazon.de', label: 'Amazon Germany', status: 'planned', lang: 'de' },
    { host: 'amazon.fr', label: 'Amazon France', status: 'planned', lang: 'fr' },
    { host: 'amazon.es', label: 'Amazon Spain', status: 'planned', lang: 'es' },
    { host: 'amazon.it', label: 'Amazon Italy', status: 'planned', lang: 'it' },
    { host: 'amazon.co.jp', label: 'Amazon Japan', status: 'planned', lang: 'ja' },
  ]);

  CS.DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 1,
    enabled: true,
    mode: 'balanced',
    failSafe: true,
    instantHide: true,
    showBadge: true,
    notifyUnsupported: true,
    debug: false,
    pages: { home: true, search: true, category: true, product: true, other: true },
    placements: { product: true, brand: true, video: true, carousel: true, banner: true, recommendation: true, other: true },
    allowlist: { asins: [], selectors: [] },
  });

  const ASIN_RE = /^[A-Z0-9]{10}$/;

  function bool(v, d) {
    return typeof v === 'boolean' ? v : d;
  }

  function boolMap(raw, defaults) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const k of Object.keys(defaults)) out[k] = bool(src[k], defaults[k]);
    return out;
  }

  function stringList(raw, { max, maxLen, map }) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const v = map(item.trim());
      if (!v || v.length > maxLen || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Returns a complete, type-safe settings object. Unknown keys are dropped. */
  CS.sanitizeSettings = function sanitizeSettings(raw) {
    const d = CS.DEFAULT_SETTINGS;
    const src = raw && typeof raw === 'object' ? raw : {};
    const allow = src.allowlist && typeof src.allowlist === 'object' ? src.allowlist : {};
    return {
      schemaVersion: d.schemaVersion,
      enabled: bool(src.enabled, d.enabled),
      mode: Object.prototype.hasOwnProperty.call(CS.MODES, src.mode) ? src.mode : d.mode,
      failSafe: bool(src.failSafe, d.failSafe),
      instantHide: bool(src.instantHide, d.instantHide),
      showBadge: bool(src.showBadge, d.showBadge),
      notifyUnsupported: bool(src.notifyUnsupported, d.notifyUnsupported),
      debug: bool(src.debug, d.debug),
      pages: boolMap(src.pages, d.pages),
      placements: boolMap(src.placements, d.placements),
      allowlist: {
        asins: stringList(allow.asins, { max: 500, maxLen: 10, map: (s) => (ASIN_RE.test(s.toUpperCase()) ? s.toUpperCase() : '') }),
        selectors: stringList(allow.selectors, { max: 50, maxLen: 200, map: (s) => s }),
      },
    };
  };

  /** Parses a user-typed list (newline/comma/space separated) into ASINs. */
  CS.parseAsinList = function parseAsinList(text) {
    return String(text || '')
      .split(/[\s,;]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ASIN_RE.test(s));
  };

  /**
   * Classifies an Amazon pathname into a page type. Language-prefixed paths such as
   * /-/es/dp/B0... are handled by stripping the prefix first.
   */
  CS.classifyPage = function classifyPage(pathname) {
    let p = String(pathname || '/').toLowerCase();
    p = p.replace(/^\/-\/[a-z]{2}(?:_[a-z]{2})?(?=\/)/, '');
    if (p === '' || p === '/' || /^\/(?:gp\/(?:home|homepage|css\/homepage)(?:\.html)?|ref=[^/]*)\/?$/.test(p)) return 'home';
    if (/^\/(?:s|search)(?:\/|$)/.test(p)) return 'search';
    if (/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|gp\/offer-listing)\/[a-z0-9]{8,}/.test(p)) return 'product';
    if (/^\/(?:b|gp\/browse\.html|gp\/bestsellers|best-sellers|gp\/new-releases|new-releases|gp\/movers-and-shakers|movers-and-shakers|gp\/most-wished-for|gp\/most-gifted|gp\/top-sellers|zgbs|deals|gp\/goldbox)(?:\/|$)/.test(p)) return 'category';
    if (/\/b\/?$/.test(p)) return 'category';
    return 'other';
  };

  /** True when hostname is amazon.com (or a subdomain of it). */
  CS.isSupportedHost = function isSupportedHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return CS.DOMAINS.some((d) => d.status === 'active' && (h === d.host || h.endsWith('.' + d.host)));
  };

  /** Settings storage helpers (chrome.storage.local). Safe to call outside extensions: they reject. */
  CS.settingsStore = {
    async load() {
      const res = await chrome.storage.local.get(CS.STORAGE.settings);
      return CS.sanitizeSettings(res[CS.STORAGE.settings]);
    },
    async save(settings) {
      const clean = CS.sanitizeSettings(settings);
      await chrome.storage.local.set({ [CS.STORAGE.settings]: clean });
      return clean;
    },
    async reset() {
      const clean = CS.sanitizeSettings(null);
      await chrome.storage.local.set({ [CS.STORAGE.settings]: clean });
      return clean;
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = CS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
