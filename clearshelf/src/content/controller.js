/*
 * Content-script controller: wires the engine into the live page.
 *
 *  - reads settings, reacts to changes
 *  - scans at load, after settle delays, and for every DOM mutation batch
 *  - detects same-document navigation (Amazon swaps content without reloading)
 *  - applies the fail-safe tripwire and the unsupported-layout notice
 *  - reports counts to the service worker and answers the popup
 *
 * Nothing here talks to the network. The only outbound channel is chrome.runtime messages to
 * this extension's own service worker.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});

  const isBrowser = typeof document !== 'undefined' && typeof location !== 'undefined';
  if (!isBrowser) return;
  if (root.top !== root) return; // top frame only; ad iframes are hidden from outside
  if (!CS.isSupportedHost(location.hostname)) return;
  if (root.__csController) return; // guard against double injection
  root.__csController = true;

  const A = CS.ATTR;
  const html = document.documentElement;

  const THROTTLE_MS = 50;
  const SETTLE_MS = [1200, 3500];
  const REPORT_MS = 250;
  const TRIPWIRE_MIN_RESULTS = 6;
  const TRIPWIRE_RATIO = 0.65;
  const MAX_PENDING_ROOTS = 60;

  let settings = CS.sanitizeSettings(null);
  let settingsLoaded = false;
  let pageType = CS.classifyPage(location.pathname);
  let engine = CS.createEngine({ settings, pageType });
  let observer = null;
  let pending = new Set();
  let flushTimer = 0;
  let lastFlush = 0;
  let reportTimer = 0;
  let lastReportedRemoved = 0;
  let lastHref = location.href;
  let settled = false;
  let settleTimers = [];
  let navTimer = 0;
  let tripped = false;
  let toastShown = false;
  let alive = true;

  const dbg = (...args) => {
    if (settings.debug) console.log('[Clearshelf]', ...args);
  };

  // ------------------------------------------------------------------ activation

  function pageEnabled() {
    return settings.enabled && settings.pages[pageType] !== false;
  }

  function hasAllowlist() {
    return settings.allowlist.asins.length > 0 || settings.allowlist.selectors.length > 0;
  }

  /** The CSS pre-pass only covers search cards, so it is only valid when those are fair game. */
  function instantAllowed() {
    return (
      pageEnabled() &&
      settings.instantHide &&
      !settings.debug &&
      !hasAllowlist() &&
      settings.placements.product &&
      (pageType === 'search' || pageType === 'category') &&
      !tripped &&
      settings.mode !== 'strict'
    );
  }

  function syncRootAttributes() {
    const set = (name, on) => {
      if (on) { if (!html.hasAttribute(name)) html.setAttribute(name, '1'); }
      else html.removeAttribute(name);
    };
    set(A.rootOn, pageEnabled() && !tripped);
    set(A.rootInstant, instantAllowed());
    set(A.rootDebug, settings.enabled && settings.debug);
  }

  // ------------------------------------------------------------------ status

  function computeStatus() {
    if (!settings.enabled) return 'disabled';
    if (settings.pages[pageType] === false) return 'page-off';
    if (tripped) return 'tripped';
    const h = engine.health();
    if (settled && !h.layoutRecognised) return 'unsupported';
    if (settled && h.unresolvedLabels > 0) return 'partial';
    return 'active';
  }

  function stateSnapshot() {
    const snap = engine.snapshot();
    return {
      status: computeStatus(),
      pageType,
      host: location.hostname,
      detected: snap.detected,
      removedOnPage: snap.removedTotal,
      byKind: snap.byKind,
      unresolved: snap.unresolved,
      perf: snap.perf,
      health: engine.health(),
      settled,
    };
  }

  // ------------------------------------------------------------------ scanning

  function fullScan() {
    if (!pageEnabled() || tripped) return;
    engine.scan(document.documentElement);
    afterScan();
  }

  function afterScan() {
    checkTripwire();
    syncRootAttributes();
    scheduleReport();
    maybeNotify();
  }

  function checkTripwire() {
    if (!settings.failSafe || tripped || engine.suspended) return;
    const h = engine.health();
    if (h.searchResultCards >= TRIPWIRE_MIN_RESULTS && h.flaggedRatio > TRIPWIRE_RATIO) {
      dbg('fail-safe tripwire:', h);
      tripped = true;
      engine.suspend('tripwire');
    }
  }

  function queueRoot(node) {
    if (!node || !node.isConnected) return;
    pending.add(node);
    schedule();
  }

  function schedule() {
    if (flushTimer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - lastFlush));
    flushTimer = setTimeout(flush, wait);
  }

  /** Drops queued roots that live inside another queued root. */
  function reduceRoots(nodes) {
    const list = [...nodes].filter((n) => n.isConnected);
    if (list.length > MAX_PENDING_ROOTS) return [document.documentElement];
    return list.filter((n) => !list.some((o) => o !== n && o.contains(n)));
  }

  function flush() {
    flushTimer = 0;
    lastFlush = performance.now();
    const roots = reduceRoots(pending);
    pending = new Set();
    if (!pageEnabled() || tripped) return;
    for (const r of roots) engine.scan(r);
    afterScan();
  }

  function onMutations(records) {
    for (const rec of records) {
      if (rec.type === 'childList') {
        for (const n of rec.addedNodes) {
          if (n.nodeType === 1) pending.add(n);
          else if (n.nodeType === 3 && n.parentElement) pending.add(n.parentElement);
        }
        // A label disappearing from inside a hidden unit means that unit must be re-validated.
        if (rec.removedNodes.length && rec.target.nodeType === 1) {
          const host = rec.target.closest('[' + A.hidden + ']');
          if (host) pending.add(host);
        }
      } else if (rec.type === 'characterData') {
        const p = rec.target.parentElement;
        if (p) pending.add(p);
      }
    }
    if (pending.size) schedule();
  }

  function startObserver() {
    if (observer || !alive) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    pending = new Set();
    clearTimeout(flushTimer);
    flushTimer = 0;
  }

  // ------------------------------------------------------------------ settings + navigation

  function applySettings(next) {
    settings = CS.sanitizeSettings(next);
    pageType = CS.classifyPage(location.pathname);
    tripped = false;
    engine.setSettings(settings, pageType);
    engine.resume();
    syncRootAttributes();
    if (pageEnabled()) {
      startObserver();
      fullScan();
      armSettleScans();
    } else {
      stopObserver();
      engine.clearAll();
      scheduleReport();
    }
  }

  function armSettleScans() {
    settleTimers.forEach(clearTimeout);
    settleTimers = [];
    settled = false;
    SETTLE_MS.forEach((ms, i) => {
      settleTimers.push(setTimeout(() => {
        if (i === SETTLE_MS.length - 1) settled = true;
        fullScan();
        scheduleReport();
        if (settled) maybeNotify();
      }, ms));
    });
  }

  function onNavigated() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    pageType = CS.classifyPage(location.pathname);
    tripped = false;
    toastShown = false;
    engine.resetForNavigation();
    engine.setPageType(pageType);
    lastReportedRemoved = 0;
    syncRootAttributes();
    if (pageEnabled()) {
      startObserver();
      fullScan();
      armSettleScans();
    } else {
      stopObserver();
    }
    scheduleReport();
  }

  function watchNavigation() {
    if (root.navigation && typeof root.navigation.addEventListener === 'function') {
      root.navigation.addEventListener('navigatesuccess', () => setTimeout(onNavigated, 0));
    }
    root.addEventListener('popstate', () => setTimeout(onNavigated, 0));
    root.addEventListener('hashchange', () => setTimeout(onNavigated, 0));
    root.addEventListener('pageshow', (e) => { if (e.persisted) { fullScan(); armSettleScans(); } });
    // Cheap fallback for pushState navigations when the Navigation API is unavailable.
    navTimer = setInterval(() => { if (document.visibilityState === 'visible') onNavigated(); }, 1000);
  }

  // ------------------------------------------------------------------ reporting

  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    stopObserver();
    settleTimers.forEach(clearTimeout);
    clearInterval(navTimer);
    clearTimeout(reportTimer);
    // The extension was reloaded or removed: give the page its content back.
    try { engine.clearAll(); } catch (e) { /* ignore */ }
    ['rootOn', 'rootInstant', 'rootDebug'].forEach((k) => html.removeAttribute(A[k]));
    root.__csController = false;
  }

  function scheduleReport() {
    if (reportTimer || !alive) return;
    reportTimer = setTimeout(sendReport, REPORT_MS);
  }

  function sendReport() {
    reportTimer = 0;
    if (!alive) return;
    if (!contextAlive()) { teardown(); return; }
    const st = stateSnapshot();
    const delta = Math.max(0, st.removedOnPage - lastReportedRemoved);
    lastReportedRemoved = st.removedOnPage;
    try {
      const p = chrome.runtime.sendMessage({
        type: CS.MSG.stats,
        delta,
        removedOnPage: st.removedOnPage,
        detected: st.detected,
        status: st.status,
        pageType: st.pageType,
        unresolved: st.unresolved,
        byKind: st.byKind,
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      /* service worker asleep or context gone; the next report retries */
    }
  }

  // ------------------------------------------------------------------ unsupported-layout notice

  function maybeNotify() {
    if (toastShown || !settled || !settings.notifyUnsupported || !CS.toast) return;
    const status = computeStatus();
    if (status !== 'partial' && status !== 'unsupported' && status !== 'tripped') return;
    toastShown = true;
    CS.toast.show(status, stateSnapshot(), () => {
      try { chrome.storage.local.set({ [CS.STORAGE.settings]: { ...settings, notifyUnsupported: false } }); } catch (e) { /* ignore */ }
    });
  }

  // ------------------------------------------------------------------ messaging

  function onMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === CS.MSG.getState) {
      sendResponse({ ok: true, state: stateSnapshot() });
      return false;
    }
    if (msg.type === CS.MSG.getDiagnostics) {
      sendResponse({ ok: true, report: { ...engine.report(), state: stateSnapshot(), path: pageType } });
      return false;
    }
    if (msg.type === CS.MSG.rescan) {
      engine.resume();
      tripped = false;
      engine.clearAll();
      fullScan();
      sendResponse({ ok: true, state: stateSnapshot() });
      return false;
    }
    return false;
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    // Hide immediately using defaults; corrected as soon as stored settings arrive.
    syncRootAttributes();
    html.setAttribute(A.rootInstant, '1');

    watchNavigation();

    try {
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[CS.STORAGE.settings]) return;
        applySettings(changes[CS.STORAGE.settings].newValue);
      });
    } catch (e) {
      teardown();
      return;
    }

    CS.settingsStore.load().then(
      (s) => { settingsLoaded = true; applySettings(s); },
      () => { settingsLoaded = true; applySettings(null); }
    );

    document.addEventListener('DOMContentLoaded', () => { if (settingsLoaded) fullScan(); }, { once: true });
    root.addEventListener('load', () => { if (settingsLoaded) fullScan(); }, { once: true });
  }

  boot();

  // Exposed for tests and the debug console only.
  CS.controller = { fullScan, stateSnapshot, engine: () => engine, applySettings };
})(typeof globalThis !== 'undefined' ? globalThis : self);
