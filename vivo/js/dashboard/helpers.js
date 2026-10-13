import { escapeHtml } from '../utils.js';

export function fmt(value, unit = '') {
  if (value === null || value === undefined) return '—';
  return `${value}${unit ? ' ' + unit : ''}`;
}

/** Wraps a block of view content in the standard white card used throughout the dashboard. */
export function viewSection(title, innerHtml) {
  return `<section class="view-section">${title ? `<h2>${escapeHtml(title)}</h2>` : ''}${innerHtml}</section>`;
}

/** Wraps a <table> in a horizontally-scrollable container so a wide table (e.g. 7 weekday columns) scrolls on its own on a narrow screen instead of the whole page. */
export function scrollableTable(tableHtml) {
  return `<div class="table-scroll">${tableHtml}</div>`;
}

export function trendText(t) {
  if (!t) return '';
  return `${t.direction} (${t.perWeek > 0 ? '+' : ''}${t.perWeek} ${t.unit})`;
}

export function emptyState(message) {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}
