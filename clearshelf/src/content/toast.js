/*
 * Small, dismissible in-page notice for "I could not safely handle this page".
 *
 * Rendered in a closed shadow root so Amazon's CSS cannot affect it and ours cannot leak.
 * Styles are applied through a constructable stylesheet because adopted stylesheets are not
 * subject to the page's Content-Security-Policy, whereas an injected <style> element could be.
 */
(function (root) {
  'use strict';
  const CS = (root.CS = root.CS || {});
  if (typeof document === 'undefined') return;

  const CSS = `
    :host { all: initial; }
    .box {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 340px;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #17202a; background: #fff; border: 1px solid #d5dbe1; border-left: 4px solid #d98200;
      border-radius: 10px; padding: 12px 14px 10px; box-shadow: 0 8px 28px rgba(15,25,35,.22);
    }
    .t { font-weight: 650; margin: 0 0 4px; }
    .m { margin: 0 0 8px; color: #3b4854; }
    .r { display: flex; gap: 8px; justify-content: flex-end; }
    button {
      font: inherit; cursor: pointer; border-radius: 6px; padding: 4px 10px;
      border: 1px solid #c3cbd3; background: #f5f7f9; color: #17202a;
    }
    button:hover { background: #e9edf1; }
    button:focus-visible { outline: 2px solid #1f6feb; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .box { color: #e8edf2; background: #1c2229; border-color: #36404a; border-left-color: #f0a030; }
      .m { color: #b4bfca; }
      button { color: #e8edf2; background: #29323b; border-color: #3d4852; }
      button:hover { background: #333e49; }
    }
  `;

  const COPY = {
    partial: (s) => ({
      title: 'Some sponsored items were left in place',
      body: `Clearshelf found ${s.unresolved} sponsored label${s.unresolved === 1 ? '' : 's'} it could not remove safely, so it left them alone rather than risk hiding real results.`,
    }),
    unsupported: () => ({
      title: 'This Amazon layout is not recognised',
      body: 'Clearshelf could not find the usual result structure on this page, so it is not hiding anything here.',
    }),
    tripped: () => ({
      title: 'Fail-safe paused removal on this page',
      body: 'An unusually large share of results looked sponsored, which suggests the page layout changed. Nothing is hidden until you reload.',
    }),
  };

  let host = null;

  function dismiss() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
  }

  function show(status, state, onNever) {
    if (host || !COPY[status]) return;
    const text = COPY[status](state);
    host = document.createElement('div');
    host.setAttribute('data-cs-toast', '');
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      /* very old engines: unstyled but functional */
    }
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'status');
    const t = document.createElement('p');
    t.className = 't';
    t.textContent = text.title;
    const m = document.createElement('p');
    m.className = 'm';
    m.textContent = text.body + ' Open the Clearshelf popup for details.';
    const row = document.createElement('div');
    row.className = 'r';
    const never = document.createElement('button');
    never.textContent = 'Don’t show again';
    never.addEventListener('click', () => { dismiss(); if (onNever) onNever(); });
    const ok = document.createElement('button');
    ok.textContent = 'Dismiss';
    ok.addEventListener('click', dismiss);
    row.append(never, ok);
    box.append(t, m, row);
    shadow.append(box);
    document.documentElement.appendChild(host);
    setTimeout(dismiss, 20000);
  }

  CS.toast = { show, dismiss };
})(typeof globalThis !== 'undefined' ? globalThis : self);
