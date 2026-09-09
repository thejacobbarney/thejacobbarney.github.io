import { METRICS, CATEGORY_ORDER, DEVICE_NOTES, guessDevice } from './metricCatalog.js';
import { guessHrvMetric } from '../parsers/fieldMapper.js';
import { daysBetween, addDays } from '../utils.js';

/**
 * Step 1 — File recognition & inventory. Pure inspection of what actually
 * landed in `records`: never assumes a field exists just because the
 * catalog knows about it.
 */
export function buildInventory(parsedFiles, mergedRecords) {
  const fileNames = parsedFiles.map((f) => f.fileName);
  const allHeaders = parsedFiles.flatMap((f) => f.headers);

  const presentFields = Object.keys(METRICS).filter((field) => mergedRecords.some((r) => r[field] !== undefined));

  const categoriesPresent = CATEGORY_ORDER.filter((cat) =>
    presentFields.some((f) => METRICS[f].category === cat)
  ).map((cat) => ({
    category: cat,
    fields: presentFields.filter((f) => METRICS[f].category === cat).map((f) => METRICS[f].label),
  }));

  const dates = mergedRecords.map((r) => r.date).sort();
  const startDate = dates[0] || null;
  const endDate = dates[dates.length - 1] || null;
  const totalDaysInRange = startDate && endDate ? daysBetween(startDate, endDate) + 1 : 0;
  const daysWithData = dates.length;

  const gaps = [];
  if (startDate && endDate) {
    const present = new Set(dates);
    let cursor = startDate;
    let gapStart = null;
    while (cursor <= endDate) {
      if (!present.has(cursor)) {
        if (!gapStart) gapStart = cursor;
      } else if (gapStart) {
        const gapLen = daysBetween(gapStart, cursor);
        if (gapLen > 2) gaps.push({ start: gapStart, end: addDays(cursor, -1), days: gapLen });
        gapStart = null;
      }
      cursor = addDays(cursor, 1);
    }
    if (gapStart) {
      const gapLen = daysBetween(gapStart, endDate) + 1;
      if (gapLen > 2) gaps.push({ start: gapStart, end: endDate, days: gapLen });
    }
  }

  const completeness = presentFields.map((field) => {
    const count = mergedRecords.filter((r) => r[field] !== undefined).length;
    return {
      field,
      label: METRICS[field].label,
      pct: totalDaysInRange ? Math.round((count / totalDaysInRange) * 100) : 0,
      sparse: totalDaysInRange ? count / totalDaysInRange < 0.5 : false,
    };
  });

  const device = guessDevice(fileNames, allHeaders);
  const hrvMetric = presentFields.includes('hrv') ? guessHrvMetric(allHeaders) : null;

  return {
    files: parsedFiles.map((f) => ({ name: f.fileName, format: f.format, rowCount: f.rowCount })),
    categoriesPresent,
    hrvMetric,
    startDate,
    endDate,
    totalDaysInRange,
    daysWithData,
    fewerThan14Days: daysWithData < 14,
    gaps,
    completeness,
    sparseFields: completeness.filter((c) => c.sparse),
    device,
    deviceNote: device ? DEVICE_NOTES[device] : null,
  };
}
