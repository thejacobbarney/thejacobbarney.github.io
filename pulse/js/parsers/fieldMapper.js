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
  { field: 'date', test: /^(date|day|calendar_date|cycle_date|cycle_start_date|sleep_date)$/ },

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
  { field: 'bedtime', test: /bedtime|sleep_start|went_to_bed|onset_time|time_in_bed_start/ },
  { field: 'waketime', test: /wake_time|wake_up_time|sleep_end|got_up|out_of_bed/ },
  { field: 'sleepDebtMin', test: /sleep_debt/ },

  // Cardio / respiratory
  { field: 'respiratoryRate', test: /respiratory_rate|breathing_rate|rpm$/ },
  { field: 'spo2Avg', test: /spo2.*avg|average.*spo2|blood_oxygen|oxygen_saturation/ },
  { field: 'spo2Min', test: /spo2.*(min|lowest)|lowest.*spo2/ },
  { field: 'rhr', test: /resting_heart_rate|resting_hr|^rhr$/ },
  { field: 'hrv', test: /hrv|rmssd|sdnn|heart_rate_variability/ },

  // Recovery / readiness
  { field: 'recoveryScore', test: /recovery_score|readiness_score|recovery(?!.*index)/ },
  { field: 'tempDeviation', test: /temp(erature)?_deviation|skin_temp|body_temp/ },
  { field: 'bodyBattery', test: /body_battery/ },
  { field: 'stressScore', test: /stress_score|avg_stress|average_stress|^stress$/ },

  // Activity / strain
  { field: 'steps', test: /^steps$|step_count/ },
  { field: 'activeCalories', test: /active_calor|activity_calor/ },
  { field: 'totalCalories', test: /total_calor|calories_burned|^calories$/ },
  { field: 'strain', test: /day_strain|^strain$/ },
  { field: 'trainingLoad', test: /training_load/ },
  { field: 'workoutMinutes', test: /workout.*(min|duration)|exercise_minutes|active_minutes/ },
  { field: 'workoutCount', test: /workout_count|number_of_workouts/ },
  { field: 'vo2max', test: /vo2_?max/ },

  // Behavioral / journal tags (free text or boolean-ish)
  { field: 'alcoholTag', test: /alcohol/ },
  { field: 'caffeineTag', test: /caffeine/ },
  { field: 'travelTag', test: /travel|jet_lag|timezone_change/ },
  { field: 'lateMealTag', test: /late_meal|ate_late/ },
  { field: 'journalNote', test: /note|journal|tag|comment/ },
];

function normalizeHeader(h) {
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

function looksTruthy(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  return !['0', 'false', 'no', 'n', 'none', 'null'].includes(s);
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
