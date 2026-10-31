/*
 * Detection engine.
 *
 *   signals  ->  unit0 (initial container)  ->  score  ->  kind/settings gates
 *            ->  final container (climb)    ->  safety  ->  hide
 *
 * The engine only ever acts on a container that has at least one piece of ad evidence, so an
 * element with no evidence cannot be hidden regardless of how it is structured. Every other
 * layer exists to stop the evidence from being applied to a container that is too large.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});
  const R = CS.resolver;
  const A = CS.ATTR;

  const LOG_LIMIT = 300;
  const UNRESOLVED_LIMIT = 100;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function describe(el) {
    if (!el || !el.tagName) return '';
    const parts = [];
    let cur = el;
    for (let i = 0; i < 3 && cur && cur.tagName; i++) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) p += '#' + String(cur.id).slice(0, 40);
      else if (typeof cur.className === 'string' && cur.className.trim()) p += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.').slice(0, 50);
      parts.unshift(p);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function createEngine(options) {
    const doc = options.doc || document;
    let settings = CS.sanitizeSettings(options.settings);
    let pageType = options.pageType || 'other';

    /** final element -> decision (only for hidden elements) */
    const flagged = new Map();
    /** unit0 element -> decision (last evaluation, hidden or not) */
    const evaluated = new Map();
    const counted = new WeakSet();
    const unresolved = new Map();
    const log = [];
    const perf = { scans: 0, ms: 0, maxMs: 0, signals: 0, lastMs: 0 };
    let removedTotal = 0;
    let suspended = null;

    // ---------------------------------------------------------------- allowlist

    function clearAllowMarks() {
      for (const el of doc.querySelectorAll('[' + A.allow + ']')) el.removeAttribute(A.allow);
    }

    function asinSelector() {
      const { asins } = settings.allowlist;
      if (!asins.length) return '';
      return asins
        .map((a) => '[data-asin="' + a + '"], a[href*="/dp/' + a + '"], a[href*="/gp/product/' + a + '"]')
        .join(',');
    }

    function applyAllowlist(rootEl) {
      const { selectors } = settings.allowlist;
      const asinSel = asinSelector();
      if (!asinSel && !selectors.length) return;
      if (asinSel) {
        for (const el of CS.signals.queryAllIncludingSelf(rootEl, asinSel)) el.setAttribute(A.allow, '1');
      }
      for (const sel of selectors) {
        try {
          for (const el of CS.signals.queryAllIncludingSelf(rootEl, sel)) el.setAttribute(A.allow, '1');
        } catch (e) {
          /* invalid user selector: ignored, the popup validates on entry */
        }
      }
    }

    // ---------------------------------------------------------------- evaluation

    function kindFacts(unit, sigs) {
      const el = unit.el;
      const hasVideoMarker = sigs.some((s) => /sbv/i.test(s.detail));
      return {
        scope: unit.scope,
        pageType,
        hasVideo: !!el.querySelector('video, [data-component-type*="video" i], [class*="sbv" i], [data-video-url]') || hasVideoMarker,
        hasBrand:
          !!el.querySelector('a[href*="/stores/"], a[href*="field-lbr_brands_browse-bin"], [data-component-type*="brand" i], [class*="brand-banner" i], [class*="brandBanner" i]') ||
          sigs.some((s) => /sbx|multi-?brand|sb[-_](?:ad|video|brand)/i.test(s.detail)),
        inCarousel: !!el.closest('.a-carousel-container, [data-a-carousel-options], ol.a-carousel'),
        hasCarousel: !!el.querySelector('.a-carousel, [data-a-carousel-options], .a-carousel-viewport'),
        isSearchResult: el.matches(R.SEARCH_RESULT_SELECTOR),
        hasAdframe: sigs.some((s) => s.family === 'adframe'),
      };
    }

    function sigSummary(sigs) {
      return sigs.map((s) => ({ family: s.family, id: s.id, detail: s.detail, weight: s.weight }));
    }

    /**
     * Evaluates one initial container. `seedSignals` may be a pre-collected list for it.
     */
    function evaluateUnit(unit0, seedSignals) {
      let sigs = seedSignals;
      if (!sigs) {
        sigs = CS.signals.collectSignals(unit0.el).filter((s) => {
          const u = R.resolveUnit0(s);
          return u && u.el === unit0.el;
        });
      }
      if (unit0.inferred) {
        // Inferred modules have no structural hook, so they score on everything inside them.
        sigs = CS.signals.collectSignals(unit0.el);
      }
      const sc = CS.scoring.score(sigs);
      const d = {
        unit0El: unit0.el,
        scope: unit0.scope,
        inferred: !!unit0.inferred,
        el: unit0.el,
        confidence: sc.confidence,
        families: sc.families,
        signals: sigSummary(sigs),
        kind: 'other',
        action: 'skip',
        reason: '',
        tag: describe(unit0.el),
      };

      if (suspended) { d.reason = 'suspended:' + suspended; return d; }
      if (!CS.scoring.meetsMode(sc, settings.mode)) { d.reason = 'below-threshold(' + settings.mode + ')'; return d; }
      if (unit0.inferred) {
        // No structural hook identifies this module, so be strict: it needs a second kind of
        // evidence, and every product inside must carry ad evidence of its own. A neighbouring
        // organic product under the same parent therefore blocks the hide.
        if (sc.families.length < 2 && settings.mode !== 'aggressive') {
          d.reason = 'inferred-module-needs-corroboration';
          d.unsafe = true;
          return d;
        }
        const evidenceEls = sigs.filter((x) => x.family !== 'label').map((x) => x.el);
        for (const p of unit0.el.querySelectorAll(R.PRODUCT_SELECTOR)) {
          const covered = flagged.has(p) || R.isInsideFlagged(p, flagged) || evidenceEls.some((e) => p.contains(e) || e.contains(p));
          if (!covered) {
            d.reason = 'inferred-module-has-unevidenced-product';
            d.unsafe = true;
            return d;
          }
        }
      }

      d.kind = CS.scoring.classifyKind(kindFacts(unit0, sigs));
      if (!settings.placements[d.kind]) { d.reason = 'placement-disabled:' + d.kind; return d; }

      const finalEl = R.finalContainer(unit0, flagged);
      let safety = R.checkSafety(finalEl, unit0.scope, flagged);
      if (safety.ok && finalEl.querySelector('[' + A.allow + ']')) safety = { ok: false, reason: 'allowlisted' };
      if (!safety.ok && finalEl !== unit0.el) {
        // The enlarged container was unsafe; fall back to the tight unit before giving up.
        safety = R.checkSafety(unit0.el, unit0.scope, flagged);
        if (safety.ok && unit0.el.querySelector('[' + A.allow + ']')) safety = { ok: false, reason: 'allowlisted' };
        if (safety.ok) d.el = unit0.el;
      } else if (safety.ok) {
        d.el = finalEl;
      }
      if (!safety.ok) { d.reason = 'unsafe:' + safety.reason; d.unsafe = true; return d; }

      d.action = 'hide';
      d.reason = 'accepted';
      return d;
    }

    // ---------------------------------------------------------------- applying decisions

    function markHidden(el, d) {
      el.setAttribute(A.hidden, '1');
      el.setAttribute(A.kind, d.kind);
      el.setAttribute(A.conf, d.confidence.toFixed(2));
      el.setAttribute(A.why, d.families.join('+'));
    }

    function unmark(el) {
      el.removeAttribute(A.hidden);
      el.removeAttribute(A.kind);
      el.removeAttribute(A.conf);
      el.removeAttribute(A.why);
    }

    function isTopLevel(el) {
      return !R.isInsideFlagged(el, flagged);
    }

    function accept(d) {
      const prev = evaluated.get(d.unit0El);
      if (prev && prev.action === 'hide' && prev.el !== d.el && flagged.get(prev.el) === prev) {
        unmark(prev.el);
        flagged.delete(prev.el);
      }
      const already = flagged.get(d.el);
      flagged.set(d.el, d);
      markHidden(d.el, d);
      if (!counted.has(d.el) && isTopLevel(d.el)) {
        counted.add(d.el);
        // Items previously counted on their own are now part of this larger placement: count
        // the placement once, not its parts as well.
        let absorbed = 0;
        for (const inner of flagged.keys()) {
          if (inner !== d.el && d.el.contains(inner) && counted.has(inner)) {
            absorbed++;
            counted.delete(inner);
          }
        }
        removedTotal = removedTotal - absorbed + 1;
      }
      return !already;
    }

    function reject(d) {
      const prev = evaluated.get(d.unit0El);
      if (prev && prev.action === 'hide' && flagged.get(prev.el) === prev) {
        unmark(prev.el);
        flagged.delete(prev.el);
      }
    }

    function record(d) {
      evaluated.set(d.unit0El, d);
      log.push({
        t: Math.round(now()),
        tag: d.tag,
        final: d.el === d.unit0El ? '=' : describe(d.el),
        scope: d.scope,
        kind: d.kind,
        confidence: +d.confidence.toFixed(3),
        families: d.families,
        signals: d.signals.map((s) => s.detail),
        action: d.action,
        reason: d.reason,
      });
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
      if (settings.debug && d.unit0El.isConnected) {
        if (d.action === 'hide') d.el.setAttribute(A.why, d.families.join('+'));
        else d.unit0El.setAttribute(A.considered, d.reason);
      }
    }

    function noteUnresolved(sig, reason) {
      // Weak families (widget ids) are noise; only unambiguous labels count as "we saw an ad".
      if (sig.family !== 'label' && sig.family !== 'feedback') return;
      if (sig.weight < 0.8) return;
      if (unresolved.size >= UNRESOLVED_LIMIT && !unresolved.has(sig.el)) return;
      unresolved.set(sig.el, { reason, tag: describe(sig.el), detail: sig.detail });
    }

    function pruneDetached() {
      for (const [el, d] of flagged) if (!el.isConnected) flagged.delete(el);
      for (const [el] of evaluated) if (!el.isConnected) evaluated.delete(el);
      for (const [el] of unresolved) if (!el.isConnected) unresolved.delete(el);
    }

    // ---------------------------------------------------------------- scanning

    /**
     * Scans a subtree (or the whole document when rootEl is omitted) and reconciles state.
     */
    function scan(rootEl) {
      const t0 = now();
      const scanRoot = rootEl || doc.documentElement;
      if (!scanRoot || !scanRoot.isConnected) return { hidden: 0, evaluated: 0 };

      if (suspended) { perf.lastMs = 0; return { hidden: 0, evaluated: 0, suspended }; }

      applyAllowlist(scanRoot);
      const seeds = CS.signals.collectSignals(scanRoot);
      perf.signals += seeds.length;

      const units = new Map(); // unit0.el -> { unit0, sigs[] }
      for (const s of seeds) {
        const u = R.resolveUnit0(s);
        if (!u) { noteUnresolved(s, 'no-container'); continue; }
        let entry = units.get(u.el);
        if (!entry) units.set(u.el, (entry = { unit0: u, sigs: [] }));
        entry.sigs.push(s);
        unresolved.delete(s.el);
      }

      // Cards first so module-level checks can see which cards are already flagged.
      const ordered = [...units.values()].sort((a, b) => (a.unit0.scope === 'card' ? 0 : 1) - (b.unit0.scope === 'card' ? 0 : 1));
      let hiddenNow = 0;
      const touched = new Set();
      for (const { unit0, sigs } of ordered) {
        // Seeds are complete for a unit when the scanned subtree contains the whole unit.
        const d = evaluateUnit(unit0, scanRoot.contains(unit0.el) ? sigs : undefined);
        touched.add(unit0.el);
        if (d.action === 'hide') { if (accept(d)) hiddenNow++; }
        else {
          reject(d);
          if (d.unsafe) for (const s of sigs) noteUnresolved(s, d.reason);
        }
        record(d);
      }

      // Revalidate flagged containers whose contents changed or that lie inside the scanned subtree.
      for (const [el, d] of [...flagged]) {
        if (!el.isConnected) { flagged.delete(el); continue; }
        if (touched.has(d.unit0El)) continue;
        if (el.contains(scanRoot) || scanRoot.contains(el)) {
          const nd = evaluateUnit({ el: d.unit0El, scope: d.scope, inferred: d.inferred });
          if (nd.action === 'hide') accept(nd);
          else reject(nd);
          record(nd);
        }
      }

      collapseCoveredModules();
      pruneDetached();

      const ms = now() - t0;
      perf.scans++;
      perf.ms += ms;
      perf.lastMs = ms;
      if (ms > perf.maxMs) perf.maxMs = ms;
      return { hidden: hiddenNow, evaluated: units.size };
    }

    /**
     * When every product inside a module has been hidden, hide the module too, so headings and
     * spacing do not linger around nothing. Works from product evidence (not carousel class
     * names), so it keeps working when Amazon renames its markup.
     */
    function collapseCoveredModules() {
      const seen = new Set();
      for (const [cardEl, cd] of [...flagged]) {
        if (cd.scope !== 'card') continue;
        const w = cardEl.parentElement && cardEl.parentElement.closest(R.WIDGET_SELECTOR);
        if (!w || seen.has(w) || R.isProtectedSelf(w)) continue;
        seen.add(w);
        if (flagged.has(w) || R.isInsideFlagged(w, flagged)) continue;
        const products = w.querySelectorAll(R.PRODUCT_SELECTOR);
        if (!products.length) continue;
        let covered = true;
        for (const p of products) if (!flagged.has(p) && !R.isInsideFlagged(p, flagged)) { covered = false; break; }
        if (!covered) continue;
        const target = R.finalContainer({ el: w, scope: 'widget' }, flagged);
        if (flagged.has(target) || R.isInsideFlagged(target, flagged)) continue;
        if (!R.checkSafety(target, 'widget', flagged).ok || target.querySelector('[' + A.allow + ']')) continue;
        if (Array.from(target.querySelectorAll(R.PRODUCT_SELECTOR)).some((n) => !w.contains(n))) continue;
        const d = {
          unit0El: target, scope: 'widget', el: target, confidence: cd.confidence, families: cd.families,
          signals: [{ family: 'derived', id: 'all-products-hidden', detail: 'all-products-hidden', weight: cd.confidence }],
          kind: cd.kind, action: 'hide', reason: 'all-products-hidden', tag: describe(target),
        };
        accept(d);
        record(d);
      }
    }

    // ---------------------------------------------------------------- lifecycle

    function clearAll() {
      for (const el of flagged.keys()) if (el.isConnected) unmark(el);
      flagged.clear();
      for (const el of doc.querySelectorAll('[' + A.considered + ']')) el.removeAttribute(A.considered);
      evaluated.clear();
    }

    function suspend(reason) {
      suspended = reason;
      clearAll();
    }

    function resume() {
      suspended = null;
    }

    function setSettings(next, nextPageType) {
      settings = CS.sanitizeSettings(next);
      if (nextPageType) pageType = nextPageType;
      clearAll();
      clearAllowMarks();
      unresolved.clear();
    }

    function setPageType(t) {
      pageType = t;
    }

    /** Called on SPA navigation: forget everything about the previous view. */
    function resetForNavigation() {
      clearAll();
      unresolved.clear();
      suspended = null;
    }

    // ---------------------------------------------------------------- health + reporting

    /** Structural sanity checks for the fail-safe tripwire and the unsupported-layout notice. */
    function health() {
      const cards = doc.querySelectorAll(R.SEARCH_RESULT_SELECTOR);
      let flaggedCards = 0;
      for (const c of cards) if (flagged.has(c) || R.isInsideFlagged(c, flagged)) flaggedCards++;
      const expectsResults = pageType === 'search' || pageType === 'category';
      const noResultsMarker = !!doc.querySelector('.s-no-results, [data-component-type="s-no-results"], .s-no-outline, #noResultsTitle');
      const anyAsin = doc.querySelector('[data-asin]:not([data-asin=""])');
      return {
        searchResultCards: cards.length,
        flaggedCards,
        flaggedRatio: cards.length ? flaggedCards / cards.length : 0,
        expectsResults,
        layoutRecognised: !expectsResults || cards.length > 0 || !!anyAsin || noResultsMarker,
        unresolvedLabels: unresolved.size,
      };
    }

    function topLevelFlagged() {
      let n = 0;
      for (const el of flagged.keys()) if (el.isConnected && isTopLevel(el)) n++;
      return n;
    }

    function snapshot() {
      const byKind = {};
      for (const [el, d] of flagged) {
        if (!isTopLevel(el)) continue;
        byKind[d.kind] = (byKind[d.kind] || 0) + 1;
      }
      return {
        detected: topLevelFlagged(),
        removedTotal,
        byKind,
        unresolved: unresolved.size,
        suspended,
        pageType,
        perf: { ...perf },
      };
    }

    function report() {
      return {
        version: CS.VERSION,
        pageType,
        mode: settings.mode,
        failSafe: settings.failSafe,
        suspended,
        health: health(),
        snapshot: snapshot(),
        unresolved: [...unresolved.values()].slice(0, 25),
        decisions: log.slice(-120),
      };
    }

    return {
      scan, clearAll, suspend, resume, setSettings, setPageType, resetForNavigation,
      health, snapshot, report, applyAllowlist, evaluateUnit,
      get flagged() { return flagged; },
      get suspended() { return suspended; },
    };
  }

  CS.createEngine = createEngine;
  CS.describeElement = describe;

  if (typeof module === 'object' && module.exports) module.exports = CS.createEngine;
})(typeof globalThis !== 'undefined' ? globalThis : self);
