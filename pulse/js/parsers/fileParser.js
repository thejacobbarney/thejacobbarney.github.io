import { parseCsv } from './csv.js';
import { normalizeRows, parseJournalRows, normalizeHeader } from './fieldMapper.js';
import { readFileAsText } from '../utils.js';

// Fields where two same-day rows genuinely represent two separate events whose
// contribution should add up (a second workout's minutes/calories, a second
// missed-sleep disturbance count) — everything else is a repeated *reading* of the
// same thing (a score, a rate, a percentage), where the sane thing to do with two
// same-day values is average them, not add them.
const ADDITIVE_FIELDS = new Set(['workoutMinutes', 'activeCalories', 'totalCalories', 'steps', 'disturbances']);
const BOOLEAN_TAG_FIELDS = new Set(['alcoholTag', 'caffeineTag', 'travelTag', 'lateMealTag']);

/**
 * Some exports are event-level rather than day-level — Whoop's workouts.csv has one row per
 * workout (several per day is common) and sleeps.csv includes naps as their own rows. This
 * folds same-date records from ONE file into a single per-day record before that file's data
 * ever reaches mergeParsedFiles, so a busy training day doesn't silently lose every workout but
 * the last, and a nap doesn't get averaged into the same night's real sleep numbers.
 */
function aggregateByDate(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  }

  const out = [];
  for (const [date, group] of groups) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const merged = { date };
    const keys = new Set();
    group.forEach((r) => Object.keys(r).forEach((k) => k !== 'date' && keys.add(k)));
    for (const key of keys) {
      const values = group.map((r) => r[key]).filter((v) => v !== undefined);
      if (values.length === 0) continue;
      if (ADDITIVE_FIELDS.has(key)) {
        merged[key] = values.reduce((a, b) => a + b, 0);
      } else if (BOOLEAN_TAG_FIELDS.has(key)) {
        merged[key] = values.some(Boolean);
      } else if (key === 'journalNote') {
        merged[key] = Array.from(new Set(values)).join(' | ');
      } else if (typeof values[0] === 'number') {
        merged[key] = values.reduce((a, b) => a + b, 0) / values.length;
      } else {
        merged[key] = values[values.length - 1];
      }
    }
    const workoutRows = group.filter((r) => r.workoutMinutes !== undefined).length;
    if (workoutRows > 0) merged.workoutCount = workoutRows;
    out.push(merged);
  }
  return out;
}

/**
 * Flattens one level of nested objects (e.g. Oura's `{ contributors: { hrv_balance: 82 } }`)
 * into `contributors_hrv_balance: 82`, so header-based field mapping can still find it.
 * Arrays and deeper nesting are left as-is (JSON.stringify'd) rather than guessed at.
 */
function flattenObject(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const flatKey = prefix ? `${prefix}_${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenObject(value, flatKey));
    } else if (Array.isArray(value)) {
      // Leave arrays out of the flat map — no canonical field expects one.
    } else {
      out[flatKey] = value;
    }
  }
  return out;
}

/** Finds the first array of plain objects nested anywhere at the top level of a JSON payload. */
function findRecordArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && value.length && typeof value[0] === 'object') return value;
    }
  }
  return null;
}

function parseJsonFile(text) {
  const data = JSON.parse(text);
  const records = findRecordArray(data);
  if (!records) {
    throw new Error('No array of daily records found in this JSON file.');
  }
  const flatRecords = records.map((r) => flattenObject(r));
  const headerSet = new Set();
  flatRecords.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);
  const rows = flatRecords.map((r) => headers.map((h) => r[h]));
  return { headers, rows };
}

/**
 * Parses one uploaded file into normalized daily records: [{ date, ...fields }].
 * Throws with a human-readable message on unsupported formats or unparseable content.
 */
export async function parseFile(file) {
  const name = file.name || '';
  const ext = name.split('.').pop().toLowerCase();

  if (ext === 'xml') {
    throw new Error(
      `${name}: XML exports (e.g. Apple Health's export.xml) aren't supported yet — export CSV or JSON instead.`
    );
  }
  if (!['csv', 'json', 'txt'].includes(ext)) {
    throw new Error(`${name}: unrecognized file type ".${ext}" — upload a CSV or JSON export.`);
  }

  const text = await readFileAsText(file);
  let headers;
  let rows;
  let format;

  if (ext === 'json') {
    format = 'JSON';
    ({ headers, rows } = parseJsonFile(text));
  } else {
    format = 'CSV';
    ({ headers, rows } = parseCsv(text));
    if (headers.length === 0) {
      throw new Error(`${name}: no data found — is this a valid CSV?`);
    }
  }

  // Long-format journal exports (one row per question, e.g. Whoop's journal_entries.csv)
  // need pivoting rather than the usual one-column-per-metric mapping — try that first.
  const journalRecords = parseJournalRows(headers, rows);
  let records;
  if (journalRecords) {
    records = journalRecords;
  } else {
    // A "Nap" flag column means this file mixes naps in among full nights of sleep (Whoop's
    // sleeps.csv); drop nap rows before the normal per-day mapping so a 20-minute nap doesn't
    // get averaged in with — or overwrite — that night's real sleep numbers.
    const napColIdx = headers.findIndex((h) => normalizeHeader(h) === 'nap');
    const dataRows = napColIdx === -1 ? rows : rows.filter((row) => !/^(true|1|yes)$/i.test(String(row[napColIdx] ?? '').trim()));
    records = normalizeRows(headers, dataRows);
  }

  if (records.length === 0) {
    throw new Error(`${name}: parsed ${rows.length} row(s) but none had a recognizable date column.`);
  }

  return { fileName: name, format, headers, rowCount: rows.length, records: aggregateByDate(records) };
}

/**
 * Merges normalized records from multiple files into one array, one entry
 * per calendar date (outer join — a date present in only one file still
 * appears, with just that file's fields). Later files win on field
 * conflicts for the same date, since a more specific/newer export is the
 * more likely reason someone uploaded a second file — EXCEPT for additive
 * fields (see ADDITIVE_FIELDS), where the max of the two wins instead. A
 * same-day workout-log file and day-summary file will both report
 * something under "calories," at very different scales (one workout's
 * calories vs. the whole day's) — taking the max avoids the smaller,
 * partial number silently clobbering the larger, complete one, whichever
 * file the browser happens to list first.
 */
export function mergeParsedFiles(parsedFiles) {
  const byDate = new Map();
  for (const parsed of parsedFiles) {
    for (const record of parsed.records) {
      const existing = byDate.get(record.date) || { date: record.date };
      const merged = { ...existing };
      for (const [key, value] of Object.entries(record)) {
        if (ADDITIVE_FIELDS.has(key) && typeof existing[key] === 'number' && typeof value === 'number') {
          merged[key] = Math.max(existing[key], value);
        } else {
          merged[key] = value;
        }
      }
      byDate.set(record.date, merged);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
