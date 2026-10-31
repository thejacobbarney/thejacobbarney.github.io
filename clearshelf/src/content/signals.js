/*
 * Signal collection: finds evidence of advertising inside a DOM subtree.
 *
 * A signal is { el, family, id, weight, detail }. Collection never decides anything;
 * the resolver maps signals to containers and the scorer decides.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});
  const V = CS.vocab;

  const SELECTOR_LIST = V.SELECTOR_SIGNALS.map((s) => s[0]).join(',');
  const SELECTOR_INFO = V.SELECTOR_SIGNALS.map(([sel, family, id]) => ({ sel, family, id }));

  function queryAllIncludingSelf(rootEl, selector) {
    const out = [];
    if (rootEl.nodeType === 1 && rootEl.matches(selector)) out.push(rootEl);
    if (rootEl.querySelectorAll) out.push(...rootEl.querySelectorAll(selector));
    return out;
  }

  /** True if the element is inert page furniture where a label word means nothing. */
  function inExcludedContext(el) {
    return !!(el.closest && el.closest(V.LABEL_EXCLUDE_ANCESTORS));
  }

  /**
   * Visibility check that does not mis-read our own hiding: content already hidden by
   * Clearshelf must still count as evidence, otherwise decisions would flap.
   */
  function isRendered(el) {
    if (el.closest('[' + CS.ATTR.hidden + ']')) return true;
    if (el.closest('[hidden]')) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkVisibilityCSS: true });
    }
    return el.getClientRects().length > 0;
  }

  /** Text labels inside a product link are product titles, not ad labels. */
  function insideProductLink(el) {
    const a = el.closest('a[href]');
    if (!a) return false;
    const href = a.getAttribute('href') || '';
    return /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{8,}/i.test(href);
  }

  function collectSelectorSignals(rootEl, push) {
    for (const el of queryAllIncludingSelf(rootEl, SELECTOR_LIST)) {
      for (const info of SELECTOR_INFO) {
        if (el.matches(info.sel)) {
          push({ el, family: info.family, id: info.id, weight: V.FAMILY_WEIGHT[info.family], detail: info.id });
        }
      }
    }
  }

  function collectHrefSignals(rootEl, push) {
    for (const a of queryAllIncludingSelf(rootEl, V.HREF_CANDIDATE_SELECTOR)) {
      const href = a.getAttribute('href') || '';
      for (const [re, id] of V.HREF_PATTERNS) {
        if (re.test(href)) {
          push({ el: a, family: 'link', id, weight: V.FAMILY_WEIGHT.link, detail: id });
          break;
        }
      }
    }
  }

  function collectWidgetSignals(rootEl, push) {
    for (const el of queryAllIncludingSelf(rootEl, V.WIDGET_CANDIDATE_SELECTOR)) {
      for (const attr of V.WIDGET_ATTRS) {
        const v = el.getAttribute(attr);
        if (v && v.length < 120 && V.WIDGET_AD_RE.test(v)) {
          push({ el, family: 'widget', id: 'widget-id', weight: V.FAMILY_WEIGHT.widget, detail: attr + '=' + v.slice(0, 60), selfUnit: true });
          break;
        }
      }
    }
  }

  function collectAttrLabelSignals(rootEl, push) {
    for (const el of queryAllIncludingSelf(rootEl, V.ATTR_CANDIDATE_SELECTOR)) {
      if (inExcludedContext(el)) continue;
      for (const attr of ['aria-label', 'title']) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const m = V.matchLabelAttr(v);
        if (!m) continue;
        // An aria-label on a product link is the product's accessible name, but Amazon prefixes
        // "Sponsored Ad -" there deliberately; only the prefix form is trusted on such links.
        if (m.form === 'aria-exact' && insideProductLink(el)) continue;
        push({ el, family: m.family, id: attr + ':' + m.form, weight: m.weight, detail: attr + ':' + m.form });
        break;
      }
    }
  }

  function collectTextLabelSignals(rootEl, push) {
    const doc = rootEl.ownerDocument || rootEl;
    const start = rootEl.nodeType === 9 ? rootEl.documentElement : rootEl;
    if (!start) return;
    // Text nodes only: far cheaper than visiting every element, and short-circuits on length.
    const walker = doc.createTreeWalker(start, 4 /* SHOW_TEXT */, {
      acceptNode(node) {
        const v = node.nodeValue;
        if (!v || v.length > 60) return 2; // FILTER_REJECT
        return 1; // FILTER_ACCEPT
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const m = V.matchLabelText(node.nodeValue);
      if (!m) continue;
      const el = node.parentElement;
      if (!el || el.closest('script, style, template, noscript')) continue;
      if (inExcludedContext(el)) continue;
      if (insideProductLink(el)) continue;
      // The element must contain only this label: a longer text in the same element
      // (for example a title with "Sponsored" in the middle) is not a label.
      const whole = V.matchLabelText(el.textContent || '');
      if (!whole) continue;
      if (!isRendered(el)) continue;
      push({ el, family: 'label', id: 'text:' + m.form, weight: whole.weight < m.weight ? whole.weight : m.weight, detail: 'text:' + m.form + ':' + m.token });
    }
  }

  /**
   * Collects every signal within rootEl (inclusive).
   * @returns {Array<{el:Element,family:string,id:string,weight:number,detail:string,selfUnit?:boolean}>}
   */
  function collectSignals(rootEl) {
    const out = [];
    const dedup = new Map(); // element -> Set of "family|id"
    const push = (s) => {
      let keys = dedup.get(s.el);
      if (!keys) dedup.set(s.el, (keys = new Set()));
      const key = s.family + '|' + s.id;
      if (keys.has(key)) return;
      keys.add(key);
      out.push(s);
    };
    collectSelectorSignals(rootEl, push);
    collectHrefSignals(rootEl, push);
    collectWidgetSignals(rootEl, push);
    collectAttrLabelSignals(rootEl, push);
    collectTextLabelSignals(rootEl, push);
    return out;
  }

  CS.signals = { collectSignals, isRendered, insideProductLink, inExcludedContext, queryAllIncludingSelf };

  if (typeof module === 'object' && module.exports) module.exports = CS.signals;
})(typeof globalThis !== 'undefined' ? globalThis : self);
