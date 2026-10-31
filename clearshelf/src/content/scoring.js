/*
 * Confidence scoring. Pure functions, no DOM.
 *
 * Evidence is combined per FAMILY with a noisy-OR: the strongest signal in each family counts
 * once, and independent families reinforce each other:
 *
 *   confidence = 1 - Π (1 - strongestWeight(family))
 *
 * A bare "Sponsored" label scores 0.85. Label + Amazon ad class scores 0.985.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});

  /** @param {Array<{family:string, weight:number}>} signals */
  function score(signals) {
    const best = Object.create(null);
    for (const s of signals) {
      if (!(s.family in best) || s.weight > best[s.family]) best[s.family] = s.weight;
    }
    const families = Object.keys(best).sort();
    let miss = 1;
    for (const f of families) miss *= 1 - best[f];
    return { confidence: families.length ? 1 - miss : 0, families, perFamily: best };
  }

  /** Does a score satisfy the chosen detection mode? */
  function meetsMode(result, modeId) {
    const mode = CS.MODES[modeId] || CS.MODES.balanced;
    // Float guard: 0.95 must accept 1 - 0.05 even when it evaluates to 0.9499999.
    const eps = 1e-9;
    return result.confidence + eps >= mode.threshold && result.families.length >= mode.minFamilies;
  }

  /**
   * Classifies a detected unit into a placement kind.
   * `facts` is a plain object so this stays testable without a DOM:
   *   scope, pageType, hasVideo, hasBrand, inCarousel, hasCarousel, isSearchResult, hasAdframe
   */
  function classifyKind(facts) {
    const { scope, pageType } = facts;
    if (facts.hasVideo) return 'video';
    if (scope !== 'card' && facts.hasBrand) return 'brand';
    if (facts.inCarousel || facts.hasCarousel) return 'carousel';
    if (facts.hasAdframe) return 'banner';
    if (scope === 'card') {
      if (facts.isSearchResult && (pageType === 'search' || pageType === 'category')) return 'product';
      if (pageType === 'home' || pageType === 'product' || pageType === 'other') return 'recommendation';
      return 'product';
    }
    if (pageType === 'search' || pageType === 'category') return 'brand';
    if (pageType === 'home' || pageType === 'product') return 'banner';
    return 'other';
  }

  CS.scoring = { score, meetsMode, classifyKind };

  if (typeof module === 'object' && module.exports) module.exports = CS.scoring;
})(typeof globalThis !== 'undefined' ? globalThis : self);
