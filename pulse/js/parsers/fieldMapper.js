/**
 * Header-name heuristics that map an uploaded export's columns onto a
 * fixed set of canonical daily metrics, regardless of which device or
 * platform produced the file. This is what lets Pulse work with an Oura,
 * Whoop, Garmin, or Fitbit CSV/JSON export (or a hand-rolled one) without
 * a separate parser per vendor.
 *
 * Every canonical field below is OPTIONAL — a column that doesn't match
 * anything is simply ignored, and a metric with no matching column never
 * appears anywhere downstream (see ARCHITECTURE.md: "only analyse what's
 * actually in the file").
 */

// Ordered list: normalized header (lowercase, non-alnum collapsed to "_")
// is tested against each pattern in turn; the first match wins for that
// column. More specific patterns are listed before more general ones.
const PATTERNS = [
  { field: 'date', test: /^(date|day|calendar_date|cycle_date|cycle_start_date|cycle_start_time|sleep_date)$/ },

  // Sleep
  { field: 'sleepScore', test: /sleep_score|sleep_performance/ },
  { field: 'sleepEfficiencyPct', test: /sleep_efficiency|efficiency_pct|^efficiency$/ },
  { field: 'sleepTotalMin', test: /total_sleep|time_asleep|minutes_asleep|asleep_duration|sleep_duration$|total_time_asleep/ },
  { field: 'deepMin', test: /deep.*(duration|min|time)|sws.*duration|^deep$/ },
  { field: 'remMin', test: /rem.*(duration|min|time)|^rem$/ },
  { field: 'lightMin', test: /light.*(duration|min|time)|^light$/ },
  { field: 'awakeMin', test: /awake.*(duration|min|time)|minutes_awake|^wake$/ },
  { field: 'sleepLatencyMin', test: /sleep_latency|latency_to_sleep|onset_latency|time_to_fall_asleep/ },
  { field: 'disturbances', test: /disturbance|awakenings|wake_count|times_woken/ },
  { field: 'restlessness', test: /restfulness|restlessness/ },
  { field: 'bedtime', test: /bedtime|sleep_start|went_to_bed|onset_time|time_in_bed_start|sleep_onset/ },
  { field: 'waketime', test: /wake_time|wake_up_time|sleep_end|got_up|out_of_bed|wake_onset/ },
  { field: 'sleepDebtMin', test: /sleep_debt/ },

  // Cardio / respiratory
  { field: 'respiratoryRate', test: /respiratory_rate|breathing_rate|rpm$/ },
  { field: 'spo2Avg', test: /spo2.*avg|average.*spo2|blood_oxygen|oxygen_saturation/ },
  { field: 'spo2Min', test: /spo2.*(min|lowest)|lowest.*spo2/ },
  { field: 'rhr', test: /resting_heart_rate|resting_hr|^rhr$/ },
  { field: 'hrv', test: /hrv|rmssd|sdnn|heart_rate_variability/ },

  // Recovery / readiness
  { field: 'recoveryScore', test: /recovery_score|readiness_score|recovery(?!.*index)/ },
  // Device-reported deviation from personal baseline (Oura-style) — kept distinct from an
  // absolute skin-temperature reading (Whoop/Garmin-style), since the two need different math
  // (see patterns.js §3D): an absolute reading has no built-in "normal" to compare against.
  { field: 'tempDeviation', test: /temp(erature)?_deviation/ },
  { field: 'skinTempC', test: /skin_temp|body_temp/ },
  { field: 'bodyBattery', test: /body_battery/ },
  { field: 'stressScore', test: /stress_score|avg_stress|average_stress|^stress$/ },

  // Activity / strain
  { field: 'steps', test: /^steps$|step_count/ },
  { field: 'activeCalories', test: /active_calor|activity_calor/ },
  { field: 'totalCalories', test: /total_calor|calories_burned|^calories$|energy_burned/ },
  { field: 'strain', test: /day_strain|^strain$/ },
  { field: 'trainingLoad', test: /training_load/ },
  { field: 'workoutMinutes', test: /workout.*(min|duration)|exercise_minutes|active_minutes|^duration_min$/ },
  { field: 'workoutCount', test: /workout_count|number_of_workouts/ },
  { field: 'vo2max', test: /vo2_?max/ },

  // Behavioral / journal tags (free text or boolean-ish)
  { field: 'alcoholTag', test: /alcohol/ },
  { field: 'caffeineTag', test: /caffeine/ },
  { field: 'travelTag', test: /travel|jet_lag|timezone_change/ },
  { field: 'lateMealTag', test: /late_meal|ate_late/ },
  { field: 'journalNote', test: /note|journal|tag|comment/ },
];

// Whoop's journal export is "long" format — one row per (cycle, question) pair, e.g.
// "Question text": "Have any alcoholic drinks?", "Answered yes": "true" — rather than one
// column per behavior. parseJournalRows() below detects and pivots that shape; this is the
// keyword table used to route a question's free text onto the same tag fields PATTERNS uses.
const TAG_KEYWORDS = [
  { field: 'alcoholTag', test: /alcohol/i },
  { field: 'caffeineTag', test: /caffeine/i },
  { field: 'travelTag', test: /travel|jet.?lag|time.?zone/i },
  { field: 'lateMealTag', test: /(late.*meal|meal.*(within|before).*(bed|sleep)|eat.*late|food.*(within|before).*(bed|sleep))/i },
];

export function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Maps each raw header string to a canonical field name, or null if unrecognized. */
export function mapHeaders(headers) {
  return headers.map((h) => {
    const norm = normalizeHeader(h);
    const match = PATTERNS.find((p) => p.test.test(norm));
    return match ? match.field : null;
  });
}

/** Best-effort guess at the HRV metric (RMSSD/SDNN) from the raw header text, for display only. */
export function guessHrvMetric(headers) {
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (!/hrv|heart_rate_variability/.test(norm)) continue;
    if (/rmssd/.test(norm)) return 'RMSSD';
    if (/sdnn/.test(norm)) return 'SDNN';
  }
  for (const h of headers) {
    if (/rmssd/i.test(h)) return 'RMSSD';
    if (/sdnn/i.test(h)) return 'SDNN';
  }
  return 'unspecified';
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '' || /^(n\/a|na|null|none|-)$/i.test(s)) return null;
  const cleaned = s.replace(/[%,]/g, '').replace(/[^\d.+-]/g, (m) => (m === '-' || m === '.' || m === '+' ? m : ''));
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Extracts a YYYY-MM-DD date from a date or datetime string in (almost) any common format. */
export function parseDateValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (usMatch) {
    const [, mo, da, yr] = usMatch;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Extracts "HH:MM" (24h) time-of-day from a datetime string, or from a bare "H:MM AM/PM" string. */
export function parseTimeOfDay(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const isoTime = /T(\d{2}):(\d{2})/.exec(s);
  if (isoTime) return `${isoTime[1]}:${isoTime[2]}`;
  const spaceTime = /^\d{4}-\d{2}-\d{2}[ T](\d{1,2}):(\d{2})/.exec(s);
  if (spaceTime) return `${spaceTime[1].padStart(2, '0')}:${spaceTime[2]}`;
  const ampm = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(s);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = ampm[2];
    const period = (ampm[3] || '').toLowerCase();
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  return null;
}

export function looksTruthy(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  return !['0', 'false', 'no', 'n', 'none', 'null'].includes(s);
}

/**
 * Detects and pivots a "long format" journal export (one row per
 * question-per-day, e.g. Whoop's journal_entries.csv: "Question text" +
 * "Answered yes" columns) into the same per-day tag records normalizeRows()
 * produces from wide-format columns. Returns null if the headers don't look
 * like this shape, so the caller can fall back to normalizeRows().
 *
 * Each matched row becomes its own tiny { date, <tagField>: boolean } record
 * rather than one accumulated record per day, because a single date can have
 * several question rows (alcohol, caffeine, travel, ...) — the caller
 * (fileParser.js: aggregateByDate) already knows how to fold same-date
 * records for a tag field together (boolean OR), so reusing it here avoids
 * a second aggregation implementation.
 */
export function parseJournalRows(headers, rows) {
  const norm = headers.map((h) => normalizeHeader(h));
  const dateIdx = norm.findIndex((h) => /cycle_start|^date$|^day$/.test(h));
  const questionIdx = norm.findIndex((h) => h.includes('question'));
  const answeredIdx = norm.findIndex((h) => h.includes('answered'));
  if (dateIdx === -1 || questionIdx === -1 || answeredIdx === -1) return null;

  const records = [];
  for (const row of rows) {
    const date = parseDateValue(row[dateIdx]);
    if (!date) continue;
    const question = String(row[questionIdx] ?? '').trim();
    if (!question) continue;
    const answeredYes = looksTruthy(row[answeredIdx]);
    const tagMatch = TAG_KEYWORDS.find((t) => t.test.test(question));
    if (tagMatch) {
      records.push({ date, [tagMatch.field]: answeredYes });
    } else if (answeredYes) {
      records.push({ date, journalNote: question });
    }
  }
  return records;
}

const BOOLEAN_TAG_FIELDS = new Set(['alcoholTag', 'caffeineTag', 'travelTag', 'lateMealTag']);
const TIME_FIELDS = new Set(['bedtime', 'waketime']);
const TEXT_FIELDS = new Set(['journalNote']);

/**
 * Normalizes parsed CSV/JSON rows into one record per row, keyed by
 * canonical field name. Rows without a resolvable date are dropped (they
 * can't be placed on the timeline). Multiple rows with fields mapped from
 * different files but the same date are merged by the caller (see
 * fileParser.js), not here.
 */
export function normalizeRows(headers, rows) {
  const fieldForCol = mapHeaders(headers);
  const dateColIdx = fieldForCol.indexOf('date');

  return rows
    .map((row) => {
      const record = {};
      let derivedDate = null;
      row.forEach((raw, i) => {
        const field = fieldForCol[i];
        if (!field) return;
        if (field === 'date') {
          record.date = parseDateValue(raw);
          return;
        }
        if (TIME_FIELDS.has(field)) {
          record[field] = parseTimeOfDay(raw);
          if (!derivedDate) derivedDate = parseDateValue(raw);
          return;
        }
        if (TEXT_FIELDS.has(field)) {
          const s = String(raw ?? '').trim();
          if (s) record[field] = s;
          return;
        }
        if (BOOLEAN_TAG_FIELDS.has(field)) {
          record[field] = looksTruthy(raw);
          return;
        }
        const n = parseNumber(raw);
        if (n !== null) record[field] = n;
      });
      if (!record.date && dateColIdx === -1 && derivedDate) {
        record.date = derivedDate;
      }
      return record;
    })
    .filter((r) => !!r.date);
}
