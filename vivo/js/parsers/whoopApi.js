import { getValidAccessToken, RELAY_BASE_URL } from '../whoopAuth.js';
import { aggregateByDate } from './fileParser.js';
import { parseDateValue, parseTimeOfDay } from './fieldMapper.js';
import { round } from '../stats.js';

/**
 * Live Whoop API data source — the "Connect Whoop" alternative to uploading
 * a CSV export. Fetches cycles/recovery/sleep/workouts through the relay
 * Worker's /proxy/* passthrough (see /whoop-relay) and maps each response
 * onto the SAME canonical record shape fieldMapper.js produces from a CSV,
 * so from here on it's indistinguishable to the rest of the app: it flows
 * through the identical mergeParsedFiles() -> buildInventory/buildBaselines/
 * buildPatterns pipeline as a file upload would.
 *
 * IMPORTANT CAVEAT (see whoop-relay/README.md): Whoop's official docs
 * weren't reachable while building this, so the field names below are a
 * best-effort reconstruction from secondary sources and general knowledge
 * of the API, not verified against a live response. `mapCycleRecord` etc.
 * are written defensively — a record that doesn't match the expected shape
 * is skipped (counted in `skippedCount`, not silently turned into wrong
 * numbers) rather than thrown. If your first real connection shows warnings
 * in the console or an unexpectedly empty report, that's this: send the
 * actual response shape and the mapping gets fixed against real data.
 */

const PAGE_LIMIT = 25; // Whoop's documented max page size.
const MAX_PAGES = 80; // Sanity bound (~2000 records) — a multi-year history, not an infinite loop.

async function fetchAllPages(path) {
  const accessToken = await getValidAccessToken();
  const records = [];
  let nextToken = null;
  let pages = 0;

  do {
    const url = new URL(`${RELAY_BASE_URL}/proxy${path}`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const response = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(`Whoop request to ${path} failed (HTTP ${response.status}): ${body?.error || body?.whoop?.error_description || 'unknown error'}`);
    }
    const data = await response.json();
    records.push(...(data.records || []));
    nextToken = data.next_token || null;
    pages += 1;
  } while (nextToken && pages < MAX_PAGES);

  return records;
}

function msToMinutes(ms) {
  return typeof ms === 'number' ? round(ms / 60000, 1) : undefined;
}

function kilojoulesToKcal(kj) {
  return typeof kj === 'number' ? round(kj / 4.184, 1) : undefined;
}

/** Wraps a per-record mapper so one malformed record doesn't throw out the whole fetch — it's skipped and counted instead. */
function safeMap(records, mapFn, warnings) {
  const mapped = [];
  let skipped = 0;
  for (const raw of records) {
    try {
      const record = mapFn(raw);
      if (record && record.date) mapped.push(record);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) warnings.push(`${skipped} of ${records.length} record(s) from this endpoint didn't match the expected shape and were skipped.`);
  return mapped;
}

function mapCycleRecord(raw) {
  const date = parseDateValue(raw.start);
  if (!date) return null;
  const score = raw.score || {};
  const record = { date };
  if (typeof score.strain === 'number') record.strain = round(score.strain, 1);
  if (typeof score.kilojoule === 'number') record.totalCalories = kilojoulesToKcal(score.kilojoule);
  return record;
}

function mapRecoveryRecord(raw) {
  const date = parseDateValue(raw.created_at || raw.updated_at);
  if (!date) return null;
  const score = raw.score || {};
  const record = { date };
  if (typeof score.recovery_score === 'number') record.recoveryScore = round(score.recovery_score, 1);
  if (typeof score.resting_heart_rate === 'number') record.rhr = round(score.resting_heart_rate, 1);
  if (typeof score.hrv_rmssd_milli === 'number') record.hrv = round(score.hrv_rmssd_milli, 1);
  if (typeof score.spo2_percentage === 'number') record.spo2Avg = round(score.spo2_percentage, 1);
  if (typeof score.skin_temp_celsius === 'number') record.skinTempC = round(score.skin_temp_celsius, 2);
  return record;
}

function mapSleepRecord(raw) {
  if (raw.nap) return null; // Naps are excluded the same way fileParser.js excludes them from a CSV export.
  const date = parseDateValue(raw.start);
  if (!date) return null;
  const score = raw.score || {};
  const stages = score.stage_summary || {};
  const record = { date };
  if (typeof score.sleep_performance_percentage === 'number') record.sleepScore = round(score.sleep_performance_percentage, 1);
  if (typeof score.sleep_efficiency_percentage === 'number') record.sleepEfficiencyPct = round(score.sleep_efficiency_percentage, 1);
  if (typeof score.respiratory_rate === 'number') record.respiratoryRate = round(score.respiratory_rate, 1);
  const totalInBed = msToMinutes(stages.total_in_bed_time_milli);
  const awake = msToMinutes(stages.total_awake_time_milli);
  if (totalInBed !== undefined && awake !== undefined) record.sleepTotalMin = round(totalInBed - awake, 1);
  if (stages.total_light_sleep_time_milli !== undefined) record.lightMin = msToMinutes(stages.total_light_sleep_time_milli);
  if (stages.total_slow_wave_sleep_time_milli !== undefined) record.deepMin = msToMinutes(stages.total_slow_wave_sleep_time_milli);
  if (stages.total_rem_sleep_time_milli !== undefined) record.remMin = msToMinutes(stages.total_rem_sleep_time_milli);
  if (awake !== undefined) record.awakeMin = awake;
  if (typeof stages.disturbance_count === 'number') record.disturbances = stages.disturbance_count;
  const bedtime = parseTimeOfDay(raw.start);
  const waketime = parseTimeOfDay(raw.end);
  if (bedtime) record.bedtime = bedtime;
  if (waketime) record.waketime = waketime;
  return record;
}

function mapWorkoutRecord(raw) {
  const date = parseDateValue(raw.start);
  if (!date || !raw.end) return null;
  const score = raw.score || {};
  const record = { date };
  const minutes = round((new Date(raw.end) - new Date(raw.start)) / 60000, 1);
  if (Number.isFinite(minutes) && minutes > 0) record.workoutMinutes = minutes;
  if (typeof score.kilojoule === 'number') record.activeCalories = kilojoulesToKcal(score.kilojoule);
  return record;
}

/**
 * Fetches cycles, recovery, sleep, and workouts from Whoop and returns the
 * same { fileName, format, records }[] shape fileParser.parseFile() does,
 * ready to pass straight into mergeParsedFiles() alongside (or instead of)
 * any uploaded files.
 *
 * @returns {Promise<{ parsedFiles: object[], warnings: string[] }>}
 */
export async function fetchWhoopData() {
  const warnings = [];
  const [cycles, recovery, sleep, workouts] = await Promise.all([
    fetchAllPages('/cycle'),
    fetchAllPages('/recovery'),
    fetchAllPages('/activity/sleep'),
    fetchAllPages('/activity/workout'),
  ]);

  const cycleRecords = safeMap(cycles, mapCycleRecord, warnings);
  const recoveryRecords = safeMap(recovery, mapRecoveryRecord, warnings);
  const sleepRecords = safeMap(sleep, mapSleepRecord, warnings);
  const workoutRecords = aggregateByDate(safeMap(workouts, mapWorkoutRecord, warnings));

  const parsedFiles = [
    { fileName: 'Whoop — Cycles (live)', format: 'API', headers: [], rowCount: cycles.length, records: cycleRecords },
    { fileName: 'Whoop — Recovery (live)', format: 'API', headers: [], rowCount: recovery.length, records: recoveryRecords },
    { fileName: 'Whoop — Sleep (live)', format: 'API', headers: [], rowCount: sleep.length, records: sleepRecords },
    { fileName: 'Whoop — Workouts (live)', format: 'API', headers: [], rowCount: workouts.length, records: workoutRecords },
  ].filter((f) => f.rowCount > 0);

  if (parsedFiles.length === 0) {
    throw new Error('Whoop returned no data for this account — nothing to analyze yet.');
  }

  return { parsedFiles, warnings };
}
