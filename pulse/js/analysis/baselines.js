import { METRICS } from './metricCatalog.js';
import { mean, round, groupBy, shiftEveningHour, formatShiftedEveningHour, parseHHMM, formatDecimalHour } from '../stats.js';
import { weekdayName } from '../utils.js';

const NUMERIC_FIELDS = Object.keys(METRICS).filter(
  (f) => !['bedtime', 'waketime', 'journalNote', 'alcoholTag', 'caffeineTag', 'travelTag', 'lateMealTag'].includes(f)
);

/** Step 2 — Baseline profile: simple averages for every metric present, plus a few grouped views. */
export function buildBaselines(records) {
  const averages = {};
  for (const field of NUMERIC_FIELDS) {
    const values = records.map((r) => r[field]).filter((v) => v !== undefined);
    if (values.length === 0) continue;
    averages[field] = { label: METRICS[field].label, unit: METRICS[field].unit, avg: round(mean(values), 1), n: values.length };
  }

  let bedtimeAvg = null;
  const bedtimeValues = records.map((r) => shiftEveningHour(r.bedtime)).filter((v) => v !== null);
  if (bedtimeValues.length) bedtimeAvg = formatShiftedEveningHour(mean(bedtimeValues));

  let waketimeAvg = null;
  const waketimeValues = records.map((r) => parseHHMM(r.waketime)).filter((v) => v !== null);
  if (waketimeValues.length) waketimeAvg = formatDecimalHour(mean(waketimeValues));

  let rhrByWeekday = null;
  if (averages.rhr) {
    const withWeekday = records.filter((r) => r.rhr !== undefined).map((r) => ({ ...r, weekday: weekdayName(r.date) }));
    const grouped = groupBy(withWeekday, (r) => r.weekday);
    const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    rhrByWeekday = order
      .filter((day) => grouped.has(day))
      .map((day) => ({ day, avg: round(mean(grouped.get(day).map((r) => r.rhr)), 1), n: grouped.get(day).length }));
  }

  let sleepArchitecturePct = null;
  if (averages.sleepTotalMin && (averages.deepMin || averages.remMin || averages.lightMin)) {
    const totalAvg = averages.sleepTotalMin.avg;
    sleepArchitecturePct = {
      deepPct: averages.deepMin ? round((averages.deepMin.avg / totalAvg) * 100, 1) : null,
      remPct: averages.remMin ? round((averages.remMin.avg / totalAvg) * 100, 1) : null,
      lightPct: averages.lightMin ? round((averages.lightMin.avg / totalAvg) * 100, 1) : null,
    };
  }

  return { averages, bedtimeAvg, waketimeAvg, rhrByWeekday, sleepArchitecturePct };
}
