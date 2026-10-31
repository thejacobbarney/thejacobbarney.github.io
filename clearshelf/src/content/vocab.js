/*
 * Detection vocabulary: what counts as evidence that something is an ad.
 *
 * Evidence is grouped into FAMILIES. Two signals from the same family are never
 * counted twice; strict mode requires two different families.
 *
 *   label    visible "Sponsored" text, or an aria-label / title saying so
 *   class    Amazon's own ad-specific class names and data-component-types
 *   link     ad click-through redirects and ad tracking parameters
 *   feedback "ad feedback" controls that Amazon attaches only to ads
 *   widget   ad-flavoured widget ids (weak: needs corroboration in Balanced mode)
 *   adframe  iframes served from Amazon's ad system
 *
 * The label family is language-driven and layout-independent, so it keeps working
 * when class names change. The class, link and feedback families are best-effort
 * knowledge of Amazon's current markup and are expected to drift; that is why they
 * are corroboration rather than the only line of defence.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});

  const FAMILY_WEIGHT = Object.freeze({
    label: 0.85,
    class: 0.9,
    link: 0.9,
    feedback: 0.85,
    widget: 0.5,
    adframe: 0.8,
  });

  /** Strong label words: "Sponsored" in the languages Amazon storefronts use. */
  const STRONG_LABELS = [
    'sponsored', 'gesponsert', 'sponsorisé', 'sponsorisée', 'sponsorisés', 'patrocinado', 'patrocinada',
    'patrocinados', 'sponsorizzato', 'sponsorizzata', 'sponsorizzati', 'gesponsord', 'sponsrad', 'sponsoreret',
    'sponsorowane', 'sponsorlu', 'スポンサー', '広告', 'anzeige', 'sponsorowany', 'patrocinat',
  ];
  /** Weaker label words that are ambiguous enough to need corroboration. */
  const WEAK_LABELS = ['ad', 'ads', 'advertisement', 'werbung', 'annonce', 'anuncio', 'publicité', 'pubblicità', 'reklam', 'advertentie'];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const strongAlt = STRONG_LABELS.map(escapeRe).join('|');
  const weakAlt = WEAK_LABELS.map(escapeRe).join('|');

  // Leading/trailing decoration that sometimes wraps a label: dots, dashes, info glyphs.
  const TRIM_RE = /^[\s\-–—:·|•.…()\[\]ⓘℹ]+|[\s\-–—:·|•.…()\[\]ⓘℹ]+$/g;
  const INVISIBLE_RE = /[​-‏‪-‮⁠﻿­]/g;

  const EXACT_STRONG = new RegExp('^(?:' + strongAlt + ')$', 'u');
  const EXACT_WEAK = new RegExp('^(?:' + weakAlt + ')$', 'u');
  // "Sponsored Ad", "Sponsored by Brand", "Sponsored - Brand". Weaker than a bare label.
  const SUFFIXED_STRONG = new RegExp(
    '^(?:' + strongAlt + ')(?:\\s+(?:ad|ads|anzeige|annonce))?(?:\\s*(?:[-–—:|·•]|\\bby\\b|\\bvon\\b|\\bpar\\b|\\bde\\b|\\bpor\\b|\\bdi\\b)\\s*\\S.{0,38})?$',
    'u'
  );
  // Prefix used by aria-label / title attributes: "Sponsored Ad – Brand product title"
  const ATTR_PREFIX = new RegExp('^(?:' + strongAlt + ')(?:\\s+(?:ad|ads|anzeige|annonce))?(?:\\s*[-–—:|·•]|\\s*$)', 'u');
  const FEEDBACK_ATTR = /\b(?:leave\s+ad\s+feedback|ad\s+feedback|feedback\s+on\s+(?:this\s+)?ad|anzeigen?-?feedback)\b/i;
  const SPONSORED_INFO_ATTR = /\b(?:sponsored|gesponsert|sponsorisé|patrocinado|sponsorizzato)\b.*\b(?:information|info|feedback|informationen)\b/i;

  /** Lower-cases, NFKC-normalises and strips invisible characters and decoration. */
  function normalizeText(raw) {
    return String(raw == null ? '' : raw)
      .replace(/[\u24D8\u2139\u{1F6C8}]/gu, ' ') // info glyphs would fold to a plain "i" under NFKC
      .normalize('NFKC')
      .replace(INVISIBLE_RE, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(TRIM_RE, '')
      .trim();
  }

  /**
   * Classifies visible text as an ad label.
   * @returns {{token:string, weight:number, form:string}|null}
   */
  function matchLabelText(raw) {
    const s = normalizeText(raw);
    if (!s || s.length > 48) return null;
    if (EXACT_STRONG.test(s)) return { token: s, weight: FAMILY_WEIGHT.label, form: 'exact' };
    if (EXACT_WEAK.test(s)) return { token: s, weight: 0.55, form: 'weak' };
    if (SUFFIXED_STRONG.test(s)) return { token: s, weight: 0.6, form: 'suffixed' };
    return null;
  }

  /**
   * Classifies an aria-label / title attribute value.
   * @returns {{weight:number, family:string, form:string}|null}
   */
  function matchLabelAttr(raw) {
    const s = normalizeText(raw);
    if (!s) return null;
    if (FEEDBACK_ATTR.test(s) && s.length <= 80) return { weight: FAMILY_WEIGHT.feedback, family: 'feedback', form: 'feedback-control' };
    if (s.length <= 80 && SPONSORED_INFO_ATTR.test(s)) return { weight: FAMILY_WEIGHT.feedback, family: 'feedback', form: 'sponsored-info-control' };
    if (EXACT_STRONG.test(s)) return { weight: FAMILY_WEIGHT.label, family: 'label', form: 'aria-exact' };
    if (ATTR_PREFIX.test(s)) return { weight: 0.88, family: 'label', form: 'aria-prefix' };
    return null;
  }

  /** Selectors whose mere presence is evidence. [selector, family, id] */
  const SELECTOR_SIGNALS = [
    // class family: Amazon's own sponsored markers
    ['.puis-sponsored-label-text', 'class', 'puis-sponsored-label-text'],
    ['.puis-sponsored-label-info-icon', 'class', 'puis-sponsored-label-info-icon'],
    ['.s-sponsored-label-text', 'class', 's-sponsored-label-text'],
    ['.s-sponsored-label-info-icon', 'class', 's-sponsored-label-info-icon'],
    ['.s-sponsored-info-icon', 'class', 's-sponsored-info-icon'],
    ['.AdHolder', 'class', 'AdHolder'],
    ['[data-component-type="sp-sponsored-result"]', 'class', 'sp-sponsored-result'],
    // link family: ad click-through redirects and tracking params
    ['a[href*="/sspa/click"]', 'link', 'sspa-click'],
    ['a[href*="/gp/slredirect/"]', 'link', 'slredirect'],
    ['a[href*="sp_csd="]', 'link', 'sp_csd'],
    ['a[href*="sp_atk="]', 'link', 'sp_atk'],
    ['a[href*="aax-us-"]', 'link', 'aax'],
    ['a[href*="amazon-adsystem.com"]', 'link', 'adsystem'],
    // feedback family
    ['[data-adfeedbackdetails]', 'feedback', 'adfeedbackdetails'],
    ['[data-ad-feedback]', 'feedback', 'data-ad-feedback'],
    ['[id^="ad-feedback"]', 'feedback', 'ad-feedback-id'],
    ['.ad-feedback-link', 'feedback', 'ad-feedback-link'],
    // widget family (weak)
    ['[data-component-type="s-ads-metrics"]', 'widget', 's-ads-metrics'],
    ['[data-ad-id]', 'widget', 'data-ad-id'],
    ['[data-ad-details]', 'widget', 'data-ad-details'],
    // adframe family
    ['iframe[src*="amazon-adsystem.com"]', 'adframe', 'adsystem-iframe'],
    ['iframe[src*="aax-us-"]', 'adframe', 'aax-iframe'],
    ['iframe[id*="adframe" i]', 'adframe', 'adframe-id'],
  ];

  /** Link-href patterns that need a regex to confirm (cheap substring selector first). */
  const HREF_CANDIDATE_SELECTOR = 'a[href*="_sspa"], a[href*="=sbx_"], a[href*="=sbv_"], a[href*="_sbv_"], a[href*="_sbv?"]';
  const HREF_PATTERNS = [
    // Amazon writes the ref tag as /ref=xyz in paths and ref_=xyz in query strings.
    [/[/?&_]ref_?=[a-z0-9_]*_sspa(?:_|\b)/i, 'ref-sspa'],
    [/[/?&_]ref_?=sbx_[a-z0-9_]+/i, 'ref-sbx'],
    [/[/?&_]ref_?=sbv_[a-z0-9_]+/i, 'ref-sbv'],
    [/[/?&_]ref_?=[a-z0-9]+_[a-z0-9]+_[a-z0-9]+_sbv\b/i, 'ref-sbv'],
  ];

  /** Elements whose id / widget attributes look ad-related. Weak signal. */
  const WIDGET_ATTRS = ['id', 'data-cel-widget', 'cel_widget_id', 'data-feature-name'];
  const WIDGET_CANDIDATE_SELECTOR = WIDGET_ATTRS.map((a) => '[' + a + ']').join(',');
  const WIDGET_AD_RE =
    /(?:^|[^a-z])(?:sp_detail\d*|sponsoredproducts\d*|sponsored[-_a-z0-9]*|adplacements?[-_a-z0-9]*|desktop[-_]?ad[-_a-z0-9]*|multi[-_]?brand[-_]?creative[-_a-z0-9]*|sbv[-_a-z0-9]*|sb[-_]?(?:ad|video|brand)[-_a-z0-9]*|ad[-_]?feedback[-_a-z0-9]*)/i;

  /** Selector that finds elements with ad-ish aria-label / title attributes. */
  const ATTR_CANDIDATE_SELECTOR = [
    '[aria-label*="ponsor" i]', '[title*="ponsor" i]',
    '[aria-label*="feedback" i]', '[aria-label*="patrocin" i]', '[aria-label*="anzeige" i]',
    '[aria-label*="gesponsert" i]', '[aria-label*="sponsoris" i]', '[aria-label*="sponsoriz" i]',
    '[aria-label*="スポンサー"]', '[aria-label*="広告"]',
  ].join(',');

  /** Elements we never treat as ad labels, wherever the text appears. */
  const LABEL_EXCLUDE_ANCESTORS =
    'script, style, template, noscript, textarea, select, option, input, button, [role="search"], [role="navigation"], nav, header, footer, form, ' +
    '#nav-belt, #navbar, #nav-main, #s-refinements, #nav-flyout-ewc, #navFooter, [role="dialog"], [role="alertdialog"]';

  CS.vocab = {
    FAMILY_WEIGHT,
    STRONG_LABELS,
    WEAK_LABELS,
    SELECTOR_SIGNALS,
    HREF_CANDIDATE_SELECTOR,
    HREF_PATTERNS,
    WIDGET_CANDIDATE_SELECTOR,
    WIDGET_AD_RE,
    WIDGET_ATTRS,
    ATTR_CANDIDATE_SELECTOR,
    LABEL_EXCLUDE_ANCESTORS,
    normalizeText,
    matchLabelText,
    matchLabelAttr,
  };

  if (typeof module === 'object' && module.exports) module.exports = CS.vocab;
})(typeof globalThis !== 'undefined' ? globalThis : self);
