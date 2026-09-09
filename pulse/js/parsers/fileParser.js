import { parseCsv } from './csv.js';
import { normalizeRows } from './fieldMapper.js';
import { readFileAsText } from '../utils.js';

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

  const records = normalizeRows(headers, rows);
  if (records.length === 0) {
    throw new Error(`${name}: parsed ${rows.length} row(s) but none had a recognizable date column.`);
  }

  return { fileName: name, format, headers, rowCount: rows.length, records };
}

/**
 * Merges normalized records from multiple files into one array, one entry
 * per calendar date (outer join — a date present in only one file still
 * appears, with just that file's fields). Later files win on field
 * conflicts for the same date, since a more specific/newer export is the
 * more likely reason someone uploaded a second file.
 */
export function mergeParsedFiles(parsedFiles) {
  const byDate = new Map();
  for (const parsed of parsedFiles) {
    for (const record of parsed.records) {
      const existing = byDate.get(record.date) || { date: record.date };
      byDate.set(record.date, { ...existing, ...record });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
