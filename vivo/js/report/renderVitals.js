import { round } from '../stats.js';
import { escapeHtml } from '../utils.js';

/**
 * The Whoop-style circular ring around whichever 0-100 baseline reads most
 * like a headline recovery number (recovery/readiness score, or sleep
 * efficiency as a fallback), plus a row of secondary metric tiles. Purely a
 * restyled view over baselines already computed by analysis/baselines.js —
 * no new math, and it disappears entirely when there's nothing suitable to
 * show (never fabricates a ring for data that isn't there).
 */

const RING_CANDIDATES = [
  { field: 'recoveryScore', label: 'Recovery' },
  { field: 'sleepEfficiencyPct', label: 'Sleep efficiency' },
];

const TILE_FIELDS = [
  { field: 'rhr', label: 'Resting HR', unit: 'bpm' },
  { field: 'hrv', label: 'HRV', unit: 'ms' },
  { field: 'sleepTotalMin', label: 'Sleep', unit: 'hr', transform: (v) => round(v / 60, 1) },
  { field: 'sleepEfficiencyPct', label: 'Sleep eff.', unit: '%' },
  { field: 'recoveryScore', label: 'Recovery', unit: '%' },
  { field: 'stressScore', label: 'Stress', unit: '' },
];

const RING_RADIUS = 48;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Picks which baseline field (if any) should headline the recovery ring. */
export function pickRingField(baselines) {
  return RING_CANDIDATES.find((c) => baselines.averages[c.field]) || null;
}

function renderRing(baselines, ring) {
  if (!ring) return '';
  const averages = baselines.averages;
  const pct = Math.max(0, Math.min(100, averages[ring.field].avg));
  const offset = round(RING_CIRCUMFERENCE * (1 - pct / 100), 2);
  return `
    <div class="vitals-ring-block">
      <div class="vitals-ring">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r="${RING_RADIUS}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="10" />
          <circle cx="55" cy="55" r="${RING_RADIUS}" fill="none" stroke="var(--mint)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${round(RING_CIRCUMFERENCE, 2)}" stroke-dashoffset="${offset}" />
        </svg>
        <div class="vitals-ring-value">${round(averages[ring.field].avg, 1)}<span>%</span></div>
      </div>
      <div class="vitals-ring-label">
        <span class="vitals-ring-eyebrow">${escapeHtml(ring.label)}</span>
        <span class="vitals-ring-caption">Baseline across ${averages[ring.field].n} tracked day(s)</span>
      </div>
    </div>`;
}

/** @param {{field: string, label: string, unit?: string}[]} [fields] - overrides the default tile set */
export function renderVitalsBar(baselines, fields) {
  const averages = baselines.averages;
  const ring = pickRingField(baselines);
  const tileFields = fields || TILE_FIELDS;

  const tiles = tileFields
    .filter((t) => (!ring || t.field !== ring.field) && averages[t.field])
    .slice(0, 4)
    .map((t) => {
      const raw = averages[t.field].avg;
      return { label: t.label, value: t.transform ? t.transform(raw) : raw, unit: t.unit };
    });

  if (!ring && tiles.length === 0) return '';

  const ringHtml = renderRing(baselines, ring);

  const tilesHtml = tiles.length
    ? `<div class="vital-tiles">${tiles
        .map(
          (t) => `
      <div class="vital-tile">
        <div class="vital-label">${escapeHtml(t.label)}</div>
        <div><span class="vital-value">${t.value}</span><span class="vital-unit">${t.unit ? ' ' + escapeHtml(t.unit) : ''}</span></div>
      </div>`
        )
        .join('')}</div>`
    : '';

  const modifier = ring ? '' : ' vitals-strip--no-ring';
  return `<div class="vitals-strip${modifier}">${ringHtml}${tilesHtml}</div>`;
}
