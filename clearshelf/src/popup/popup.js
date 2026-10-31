/*
 * Popup controller. Reads and writes settings in chrome.storage.local (the content scripts and
 * service worker react to the change), and shows live state fetched from the active tab.
 */
(function () {
  'use strict';
  const CS = globalThis.CS;
  const $ = (id) => document.getElementById(id);

  let settings = CS.sanitizeSettings(null);
  let tabState = null; // live state from the content script, or null
  let tabProblem = null; // 'not-amazon' | 'reload'
  let activeTabId = null;
  let pollTimer = 0;

  // ------------------------------------------------------------------ storage

  async function saveSettings(patch) {
    settings = CS.sanitizeSettings({ ...settings, ...patch });
    await CS.settingsStore.save(settings);
    renderSettings();
    renderStatus();
  }

  async function loadSession() {
    try {
      const res = await chrome.storage.session.get(CS.STORAGE.session);
      return res[CS.STORAGE.session] || { removedTotal: 0 };
    } catch (e) {
      return { removedTotal: 0 };
    }
  }

  // ------------------------------------------------------------------ tab state

  async function refreshTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab && tab.id;
      if (activeTabId == null) { tabState = null; tabProblem = 'not-amazon'; return; }
      const res = await chrome.tabs.sendMessage(activeTabId, { type: CS.MSG.getState });
      if (res && res.ok) { tabState = res.state; tabProblem = null; }
      else { tabState = null; tabProblem = 'reload'; }
    } catch (e) {
      // No listener: either not an Amazon tab, or an Amazon tab opened before the extension loaded.
      tabState = null;
      const url = (await chrome.tabs.get(activeTabId).catch(() => null))?.url || '';
      tabProblem = /^https:\/\/(www\.)?amazon\.com\//.test(url) ? 'reload' : 'not-amazon';
    }
  }

  // ------------------------------------------------------------------ render: status + stats

  const STATUS_COPY = {
    active: { tone: 'good', title: 'Active', detail: 'Removing sponsored listings on this page.' },
    partial: { tone: 'warn', title: 'Partly active', detail: '' },
    unsupported: { tone: 'warn', title: 'Layout not recognised', detail: 'This page does not match any layout Clearshelf knows, so nothing is hidden here.' },
    tripped: { tone: 'bad', title: 'Fail-safe engaged', detail: 'Too many results looked sponsored, so removal is paused on this page. Use Rescan to try again.' },
    disabled: { tone: 'neutral', title: 'Paused', detail: 'Clearshelf is turned off. Amazon looks the way it normally does.' },
    'page-off': { tone: 'neutral', title: 'Off for this page type', detail: 'You turned off removal for this kind of page in Settings.' },
    'not-amazon': { tone: 'neutral', title: 'Not an Amazon page', detail: 'Open amazon.com to see live counts. Settings still apply.' },
    reload: { tone: 'warn', title: 'Reload this tab', detail: 'This tab was opened before Clearshelf was installed or updated.' },
  };

  function renderStatus() {
    let key;
    if (!settings.enabled) key = 'disabled';
    else if (tabProblem) key = tabProblem;
    else key = (tabState && tabState.status) || 'active';
    const c = STATUS_COPY[key] || STATUS_COPY.active;
    let detail = c.detail;
    if (key === 'partial' && tabState) {
      detail = `${tabState.unresolved} sponsored label${tabState.unresolved === 1 ? '' : 's'} found that could not be removed safely, so ${tabState.unresolved === 1 ? 'it was' : 'they were'} left in place.`;
    }
    if (key === 'active' && tabState && settings.debug) detail = 'Debug mode: sponsored items are outlined, not hidden.';
    $('status').dataset.tone = c.tone;
    $('status-title').textContent = c.title;
    $('status-detail').textContent = detail;
    $('master').checked = settings.enabled;
    $('host-line').textContent = tabState ? `${tabState.host} · ${labelForPage(tabState.pageType)}` : 'Sponsored listing remover';
  }

  function labelForPage(id) {
    const p = CS.PAGE_TYPES.find((x) => x.id === id);
    return p ? p.label.split(' and ')[0].toLowerCase() : id;
  }

  async function renderStats() {
    const session = await loadSession();
    $('stat-session').textContent = String(session.removedTotal || 0);
    $('stat-page').textContent = tabState ? String(tabState.removedOnPage) : '0';
    $('stat-detected').textContent = tabState ? String(tabState.detected) : '0';

    const list = $('kinds');
    list.textContent = '';
    const by = (tabState && tabState.byKind) || {};
    let any = false;
    for (const k of CS.KINDS) {
      if (!by[k.id]) continue;
      any = true;
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = k.label;
      const n = document.createElement('b');
      n.textContent = String(by[k.id]);
      li.append(name, n);
      list.append(li);
    }
    $('kinds-empty').hidden = any;
  }

  // ------------------------------------------------------------------ render: settings

  function buildStatic() {
    // Modes
    const modes = $('modes');
    for (const m of Object.values(CS.MODES)) {
      const label = document.createElement('label');
      label.className = 'mode';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'mode';
      input.value = m.id;
      input.addEventListener('change', () => saveSettings({ mode: m.id }));
      const text = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = m.label;
      const small = document.createElement('small');
      small.textContent = m.hint;
      text.append(b, small);
      label.append(input, text);
      modes.append(label);
    }
    // Placements
    const pl = $('placements');
    for (const k of CS.KINDS) {
      const row = checkRow(k.label, k.hint, 'pl-' + k.id, (v) => saveSettings({ placements: { ...settings.placements, [k.id]: v } }));
      pl.append(row);
    }
    // Pages
    const pg = $('pages');
    for (const p of CS.PAGE_TYPES) {
      const row = checkRow(p.label, '', 'pg-' + p.id, (v) => saveSettings({ pages: { ...settings.pages, [p.id]: v } }));
      row.classList.add('compact');
      pg.append(row);
    }
    // Domains
    const dl = $('domains');
    for (const d of CS.DOMAINS) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = d.host;
      name.title = d.label;
      const pill = document.createElement('span');
      pill.className = 'pill ' + d.status;
      pill.textContent = d.status === 'active' ? 'Active' : 'Planned';
      li.append(name, pill);
      dl.append(li);
    }
    $('version').textContent = 'Clearshelf v' + CS.VERSION;
  }

  function checkRow(title, hint, id, onChange) {
    const label = document.createElement('label');
    label.className = 'row';
    const text = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = title;
    text.append(b);
    if (hint) {
      const small = document.createElement('small');
      small.textContent = hint;
      text.append(small);
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(text, input);
    return label;
  }

  function renderSettings() {
    for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === settings.mode;
    for (const key of ['failSafe', 'instantHide', 'notifyUnsupported', 'showBadge', 'debug']) $('opt-' + key).checked = settings[key];
    for (const k of CS.KINDS) $('pl-' + k.id).checked = settings.placements[k.id];
    for (const p of CS.PAGE_TYPES) $('pg-' + p.id).checked = settings.pages[p.id];
    const setIfIdle = (el, v) => { if (document.activeElement !== el) el.value = v; };
    setIfIdle($('allow-asins'), settings.allowlist.asins.join('\n'));
    setIfIdle($('allow-selectors'), settings.allowlist.selectors.join('\n'));
    $('opt-instantHide').disabled = settings.mode === 'strict' || settings.debug;
  }

  // ------------------------------------------------------------------ allowlist input

  function validSelector(sel) {
    try { document.createDocumentFragment().querySelector(sel); return true; } catch (e) { return false; }
  }

  let allowTimer = 0;
  function onAllowInput() {
    clearTimeout(allowTimer);
    allowTimer = setTimeout(() => {
      const rawAsins = $('allow-asins').value.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const asins = CS.parseAsinList($('allow-asins').value);
      const lines = $('allow-selectors').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const selectors = lines.filter(validSelector);
      const problems = [];
      if (rawAsins.length !== asins.length) problems.push(`${rawAsins.length - asins.length} ASIN${rawAsins.length - asins.length === 1 ? '' : 's'} ignored (must be 10 letters or digits)`);
      if (lines.length !== selectors.length) problems.push(`${lines.length - selectors.length} invalid selector${lines.length - selectors.length === 1 ? '' : 's'} ignored`);
      $('allow-msg').textContent = problems.join('. ');
      saveSettings({ allowlist: { asins, selectors } });
    }, 450);
  }

  // ------------------------------------------------------------------ actions

  async function copyDiagnostics() {
    const note = $('copy-note');
    try {
      if (activeTabId == null || !tabState) throw new Error('no-tab');
      const res = await chrome.tabs.sendMessage(activeTabId, { type: CS.MSG.getDiagnostics });
      const text = JSON.stringify({ extension: 'clearshelf', version: CS.VERSION, settings: { ...settings, allowlist: { asins: settings.allowlist.asins.length, selectors: settings.allowlist.selectors.length } }, ...res.report }, null, 2);
      await navigator.clipboard.writeText(text);
      note.textContent = 'Diagnostics copied. They contain no URLs, titles or personal data.';
    } catch (e) {
      note.textContent = 'Open an Amazon page first, then try again.';
    }
  }

  async function rescan() {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: CS.MSG.rescan });
      await tick();
    } catch (e) {
      $('copy-note').textContent = 'Open an Amazon page first, then try again.';
    }
  }

  let resetArmed = 0;
  async function onReset() {
    const btn = $('btn-reset');
    if (!resetArmed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Click again to confirm';
      resetArmed = setTimeout(() => { resetArmed = 0; delete btn.dataset.armed; btn.textContent = 'Reset settings'; }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = 0;
    delete btn.dataset.armed;
    btn.textContent = 'Reset settings';
    settings = await CS.settingsStore.reset();
    renderSettings();
    renderStatus();
    $('reset-note').textContent = 'Settings restored to defaults.';
  }

  async function onResetStats() {
    await chrome.storage.session.remove(CS.STORAGE.session).catch(() => {});
    await chrome.storage.local.remove(CS.STORAGE.lifetime).catch(() => {});
    $('reset-note').textContent = 'Statistics cleared.';
    renderStats();
  }

  // ------------------------------------------------------------------ tabs UI

  function selectTab(name) {
    for (const t of ['overview', 'settings']) {
      const on = t === name;
      $('tab-' + t).setAttribute('aria-selected', String(on));
      $('tab-' + t).tabIndex = on ? 0 : -1;
      $('view-' + t).hidden = !on;
    }
  }

  function wireTabs() {
    $('tab-overview').addEventListener('click', () => selectTab('overview'));
    $('tab-settings').addEventListener('click', () => selectTab('settings'));
    for (const id of ['tab-overview', 'tab-settings']) {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const next = id === 'tab-overview' ? 'settings' : 'overview';
          selectTab(next);
          $('tab-' + next).focus();
        }
      });
    }
  }

  // ------------------------------------------------------------------ boot

  async function tick() {
    await refreshTab();
    renderStatus();
    await renderStats();
  }

  async function boot() {
    buildStatic();
    wireTabs();
    settings = await CS.settingsStore.load();
    renderSettings();

    $('master').addEventListener('change', (e) => saveSettings({ enabled: e.target.checked }));
    for (const key of ['failSafe', 'instantHide', 'notifyUnsupported', 'showBadge', 'debug']) {
      $('opt-' + key).addEventListener('change', (e) => saveSettings({ [key]: e.target.checked }));
    }
    $('allow-asins').addEventListener('input', onAllowInput);
    $('allow-selectors').addEventListener('input', onAllowInput);
    $('btn-copy').addEventListener('click', copyDiagnostics);
    $('btn-rescan').addEventListener('click', rescan);
    $('btn-reset').addEventListener('click', onReset);
    $('btn-reset-stats').addEventListener('click', onResetStats);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[CS.STORAGE.settings]) {
        settings = CS.sanitizeSettings(changes[CS.STORAGE.settings].newValue);
        renderSettings();
        renderStatus();
      }
      if (area === 'session') renderStats();
    });

    await tick();
    pollTimer = setInterval(tick, 1000);
    window.addEventListener('unload', () => clearInterval(pollTimer));
  }

  boot();
})();
