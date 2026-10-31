/*
 * Clearshelf service worker.
 *
 * Deliberately small. It never touches the network and never sees page content, only
 * counters and a status word sent by this extension's own content scripts:
 *   - keeps session statistics (chrome.storage.session, cleared when the browser closes)
 *   - keeps a lifetime counter (chrome.storage.local, a single number)
 *   - drives the toolbar badge and icon
 *   - writes default settings on first install
 *
 * MV3 workers are killed when idle, so nothing important lives in memory: state is read from
 * and written to storage, and updates are serialised to avoid lost increments.
 */
importScripts('../shared/constants.js');

const CS = self.CS;
const SESSION_KEY = CS.STORAGE.session;
const LIFETIME_KEY = CS.STORAGE.lifetime;

const BADGE_COLORS = {
  active: '#1f6feb',
  partial: '#b86e00',
  unsupported: '#b86e00',
  tripped: '#b3261e',
};

let queue = Promise.resolve();
function serialize(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function readSession() {
  const res = await chrome.storage.session.get(SESSION_KEY);
  const s = res[SESSION_KEY];
  return s && typeof s === 'object' ? { removedTotal: s.removedTotal || 0, tabs: s.tabs || {}, startedAt: s.startedAt || Date.now() } : { removedTotal: 0, tabs: {}, startedAt: Date.now() };
}

async function writeSession(s) {
  await chrome.storage.session.set({ [SESSION_KEY]: s });
}

async function addLifetime(delta) {
  if (!delta) return;
  const res = await chrome.storage.local.get(LIFETIME_KEY);
  const cur = res[LIFETIME_KEY] || { removed: 0, since: Date.now() };
  cur.removed += delta;
  await chrome.storage.local.set({ [LIFETIME_KEY]: cur });
}

async function updateBadge(tabId, info) {
  const settings = await CS.settingsStore.load();
  if (!settings.enabled || !settings.showBadge) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  let text = '';
  if (info.status === 'unsupported') text = '?';
  else if (info.status === 'tripped') text = '!';
  else if (info.status === 'partial') text = info.removedOnPage > 0 ? String(Math.min(info.removedOnPage, 99)) : '!';
  else if (info.status === 'active' && info.removedOnPage > 0) text = info.removedOnPage > 99 ? '99+' : String(info.removedOnPage);
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[info.status] || BADGE_COLORS.active });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
}

async function setIcons(enabled) {
  const prefix = enabled ? 'icon' : 'icon-off';
  await chrome.action.setIcon({
    path: { 16: `icons/${prefix}-16.png`, 32: `icons/${prefix}-32.png`, 48: `icons/${prefix}-48.png`, 128: `icons/${prefix}-128.png` },
  });
}

async function onStats(msg, sender) {
  const tab = sender && sender.tab;
  if (!tab || typeof tab.id !== 'number') return;
  const delta = Number.isFinite(msg.delta) && msg.delta > 0 ? Math.min(msg.delta, 10000) : 0;
  await serialize(async () => {
    const s = await readSession();
    s.removedTotal += delta;
    s.tabs[tab.id] = {
      removedOnPage: msg.removedOnPage | 0,
      detected: msg.detected | 0,
      status: String(msg.status || 'active'),
      pageType: String(msg.pageType || 'other'),
      updatedAt: Date.now(),
    };
    await writeSession(s);
    await addLifetime(delta);
  });
  await updateBadge(tab.id, msg);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== CS.MSG.stats) return false;
  // Only our own content scripts (which carry a tab) are accepted.
  if (sender.id !== chrome.runtime.id) return false;
  onStats(msg, sender).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialize(async () => {
    const s = await readSession();
    if (s.tabs[tabId]) {
      delete s.tabs[tabId];
      await writeSession(s);
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CS.STORAGE.settings]) return;
  const next = CS.sanitizeSettings(changes[CS.STORAGE.settings].newValue);
  setIcons(next.enabled).catch(() => {});
  if (!next.enabled || !next.showBadge) {
    chrome.tabs.query({}).then((tabs) => {
      for (const t of tabs) chrome.action.setBadgeText({ tabId: t.id, text: '' }).catch(() => {});
    }).catch(() => {});
  }
});

async function init() {
  const res = await chrome.storage.local.get(CS.STORAGE.settings);
  if (!res[CS.STORAGE.settings]) await CS.settingsStore.reset();
  const settings = await CS.settingsStore.load();
  await setIcons(settings.enabled);
}

chrome.runtime.onInstalled.addListener(() => { init().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { init().catch(() => {}); });
