/**
 * Dependency-free numeric helpers shared by the analysis modules.
 * Every function tolerates missing values (null/undefined/NaN) by
 * filtering them out first, and returns null (never NaN) when there
 * isn't enough data to answer the question.
 */

export function mean(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((sum, v) => sum + (v - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function min(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? Math.min(...xs) : null;
}

export function max(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? Math.max(...xs) : null;
}

export function percentile(values, p) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

/**
 * Least-squares slope of ys against a 0..n-1 index (i.e. "per unit step",
 * where a step is whatever order the caller passed the array in — usually
 * one calendar day). Returns null with fewer than 3 points.
 */
export function linregSlope(ys) {
  const pts = [];
  ys.forEach((y, i) => {
    if (typeof y === 'number' && Number.isFinite(y)) pts.push([i, y]);
  });
  if (pts.length < 3) return null;
  const n = pts.length;
  const sumX = pts.reduce((s, [x]) => s + x, 0);
  const sumY = pts.reduce((s, [, y]) => s + y, 0);
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0);
  const sumXX = pts.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Pearson correlation between two equal-length arrays, pairwise-ignoring nulls. */
export function correlation(a, b) {
  const pairs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      pairs.push([x, y]);
    }
  }
  if (pairs.length < 4) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < pairs.length; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

export function round(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Groups an array of records by the result of keyFn, returning a Map. */
export function groupBy(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * Converts "HH:MM" (24h) to a shifted decimal-hour scale where 18:00 = 0
 * and times wrap forward through midnight up to 42 (= 18:00 next day).
 * This keeps a typical bedtime range (e.g. 21:30-01:30) contiguous instead
 * of splitting across the 0:00 boundary, so mean/stddev work correctly.
 * Use only for evening-anchored times (bedtime); wake times don't need it.
 */
export function shiftEveningHour(hhmm) {
  const parsed = parseHHMM(hhmm);
  if (parsed === null) return null;
  let shifted = parsed - 18;
  if (shifted < 0) shifted += 24;
  return shifted;
}

export function parseHHMM(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h + min / 60;
}

/** Formats a shifted evening-hour value (see shiftEveningHour) back to "H:MM AM/PM". */
export function formatShiftedEveningHour(shifted) {
  if (shifted === null || shifted === undefined) return null;
  let hours = (shifted + 18) % 24;
  return formatDecimalHour(hours);
}

export function formatDecimalHour(hours) {
  if (hours === null || hours === undefined) return null;
  let h = Math.floor(hours) % 24;
  const min = Math.round((hours - Math.floor(hours)) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(min).padStart(2, '0')} ${period}`;
}
