export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function fmtPts(n) {
  return typeof n === 'number' ? n.toFixed(1) : '—';
}

/** Renders a cited-sources list; only http(s) URLs become links (model/search output is untrusted). */
export function sourceLinksHtml(sources) {
  const safe = (sources || []).filter((u) => /^https?:\/\//i.test(u));
  if (safe.length === 0) return '';
  return `<div class="ai-move-group"><h4>Sources</h4><ul class="plain-list">${safe
    .map(
      (u) =>
        `<li class="small"><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60))}</a></li>`
    )
    .join('')}</ul></div>`;
}
