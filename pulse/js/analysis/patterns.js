import { mean, stddev, min as minOf, percentile, linregSlope, correlation, round, shiftEveningHour, parseHHMM } from '../stats.js';
import { addDays, weekdayName } from '../utils.js';

const SLEEP_ARCHITECTURE_NORMS = { deepPct: [13, 23], remPct: [20, 25], lightPct: [45, 60] };

function byDate(records) {
  const map = new Map();
  for (const r of records) map.set(r.date, r);
  return map;
}

/** Pairs field `a` on date D with field `b` on date D+shiftDays (0 = same day), skipping dates where either is missing. */
function pairedShift(records, dateMap, fieldA, fieldB, shiftDays) {
  const xs = [];
  const ys = [];
  const details = [];
  for (const r of records) {
    if (r[fieldA] === undefined) continue;
    const otherDate = shiftDays === 0 ? r.date : addDays(r.date, shiftDays);
    const other = dateMap.get(otherDate);
    if (!other || other[fieldB] === undefined) continue;
    xs.push(r[fieldA]);
    ys.push(other[fieldB]);
    details.push({ date: r.date, a: r[fieldA], b: other[fieldB] });
  }
  return { xs, ys, details };
}

/** Compares average of `targetField` on the day after tagField was true vs the day after it was false. */
function avgAfterTag(records, dateMap, tagField, targetField, shiftDays = 1) {
  const after = pairedShift(records, dateMap, tagField, targetField, shiftDays);
  if (after.xs.length === 0) return null;
  const trueVals = [];
  const falseVals = [];
  after.xs.forEach((tag, i) => (tag ? trueVals : falseVals).push(after.ys[i]));
  if (trueVals.length === 0) return null;
  return {
    avgAfterTrue: round(mean(trueVals), 1),
    avgAfterFalse: falseVals.length ? round(mean(falseVals), 1) : null,
    nTrue: trueVals.length,
    nFalse: falseVals.length,
  };
}

function trendLabel(slope, unit = '') {
  if (slope === null) return null;
  const dir = slope > 0.01 ? 'rising' : slope < -0.01 ? 'falling' : 'flat';
  return { slope: round(slope, 3), perWeek: round(slope * 7, 1), direction: dir, unit };
}

export function buildPatterns(records, baselines) {
  const dateMap = byDate(records);
  const patterns = {};

  // ── 3A Sleep ──────────────────────────────────────────────
  const sleep = {};
  const bedtimes = records.map((r) => shiftEveningHour(r.bedtime)).filter((v) => v !== null);
  const waketimes = records.map((r) => parseHHMM(r.waketime)).filter((v) => v !== null);
  if (bedtimes.length >= 3) {
    sleep.bedtimeVarianceMin = round(stddev(bedtimes) * 60, 0);
    sleep.bedtimeHighVariance = sleep.bedtimeVarianceMin > 45;
  }
  if (waketimes.length >= 3) {
    sleep.waketimeVarianceMin = round(stddev(waketimes) * 60, 0);
    sleep.waketimeHighVariance = sleep.waketimeVarianceMin > 45;
  }
  const sleepTotals = records.filter((r) => r.sleepTotalMin !== undefined).map((r) => r.sleepTotalMin);
  if (sleepTotals.length >= 3) sleep.durationTrend = trendLabel(linregSlope(sleepTotals), 'min/week');
  if (baselines.sleepArchitecturePct) {
    sleep.architecture = { ...baselines.sleepArchitecturePct, norms: SLEEP_ARCHITECTURE_NORMS };
    sleep.architectureFlags = Object.entries(SLEEP_ARCHITECTURE_NORMS)
      .filter(([k]) => baselines.sleepArchitecturePct[k] !== null && baselines.sleepArchitecturePct[k] !== undefined)
      .filter(([k, [lo, hi]]) => baselines.sleepArchitecturePct[k] < lo || baselines.sleepArchitecturePct[k] > hi)
      .map(([k, [lo, hi]]) => ({ field: k, value: baselines.sleepArchitecturePct[k], norm: [lo, hi] }));
  }
  if (baselines.averages.sleepEfficiencyPct) {
    sleep.lowEfficiency = baselines.averages.sleepEfficiencyPct.avg < 85;
  }
  if (baselines.averages.sleepLatencyMin) {
    sleep.highLatency = baselines.averages.sleepLatencyMin.avg > 20;
  }
  const respRates = records.filter((r) => r.respiratoryRate !== undefined).map((r) => r.respiratoryRate);
  if (respRates.length >= 3) sleep.respiratoryTrend = trendLabel(linregSlope(respRates), 'br/min per week');
  const spo2Values = records.filter((r) => r.spo2Avg !== undefined).map((r) => r.spo2Avg);
  const spo2Mins = records.filter((r) => r.spo2Min !== undefined).map((r) => r.spo2Min);
  if (spo2Values.length || spo2Mins.length) {
    sleep.spo2 = {
      avg: spo2Values.length ? round(mean(spo2Values), 1) : null,
      min: spo2Mins.length ? round(minOf(spo2Mins), 1) : null,
      daysBelow94: records.filter((r) => (r.spo2Min ?? r.spo2Avg) !== undefined && (r.spo2Min ?? r.spo2Avg) < 94).length,
    };
  }
  if (Object.keys(sleep).length) patterns.sleep = sleep;

  // ── 3B HRV ────────────────────────────────────────────────
  const hrvRecords = records.filter((r) => r.hrv !== undefined);
  if (hrvRecords.length >= 4) {
    const hrvValues = hrvRecords.map((r) => r.hrv);
    const hrv = { trend: trendLabel(linregSlope(hrvValues), 'ms/week') };
    const diffs = [];
    for (let i = 1; i < hrvValues.length; i++) diffs.push(hrvValues[i] - hrvValues[i - 1]);
    hrv.dayToDayVariability = round(stddev(diffs), 1);
    if (hrvValues.length >= 14) {
      const first7 = mean(hrvValues.slice(0, 7));
      const last7 = mean(hrvValues.slice(-7));
      hrv.first7DayAvg = round(first7, 1);
      hrv.last7DayAvg = round(last7, 1);
      hrv.changePct = round(((last7 - first7) / first7) * 100, 1);
    }
    if (hrvValues.length >= 28) {
      const rolling28 = mean(hrvValues.slice(-28));
      const latest = hrvValues[hrvValues.length - 1];
      hrv.rolling28DayAvg = round(rolling28, 1);
      hrv.latest = round(latest, 1);
      hrv.latestVsRolling = round(latest - rolling28, 1);
    }
    const bedtimeShiftedHours = records.filter((r) => r.bedtime !== undefined && r.hrv !== undefined).map((r) => shiftEveningHour(r.bedtime));
    const hrvForBedtime = records.filter((r) => r.bedtime !== undefined && r.hrv !== undefined).map((r) => r.hrv);
    if (bedtimeShiftedHours.length >= 4) {
      hrv.bedtimeCorrelation = round(correlation(bedtimeShiftedHours, hrvForBedtime), 2);
    }
    const priorLoadField = records.some((r) => r.strain !== undefined) ? 'strain' : 'trainingLoad';
    const strainVsNextHrv = pairedShift(records, dateMap, priorLoadField, 'hrv', 1);
    if (strainVsNextHrv.xs.length >= 4) {
      hrv.priorStrainCorrelation = round(correlation(strainVsNextHrv.xs, strainVsNextHrv.ys), 2);
      hrv.priorStrainField = priorLoadField;
    }
    if (baselines.averages.recoveryScore) {
      const recoveryVsHrv = pairedShift(records, dateMap, 'hrv', 'recoveryScore', 0);
      if (recoveryVsHrv.xs.length >= 4) hrv.recoveryCorrelation = round(correlation(recoveryVsHrv.xs, recoveryVsHrv.ys), 2);
    }
    patterns.hrv = hrv;
  }

  // ── 3C Resting heart rate ─────────────────────────────────
  const rhrRecords = records.filter((r) => r.rhr !== undefined);
  if (rhrRecords.length >= 4) {
    const rhrValues = rhrRecords.map((r) => r.rhr);
    const baseline = mean(rhrValues);
    const rhr = { trend: trendLabel(linregSlope(rhrValues), 'bpm/week'), baseline: round(baseline, 1) };
    const elevated = rhrRecords.filter((r) => r.rhr > baseline + 5);
    rhr.elevationEvents = elevated.slice(-10).map((r) => ({ date: r.date, value: r.rhr, delta: round(r.rhr - baseline, 1) }));
    rhr.elevationCount = elevated.length;
    patterns.rhr = rhr;
  }

  // ── 3D Body temperature ───────────────────────────────────
  const tempRecords = records.filter((r) => r.tempDeviation !== undefined);
  if (tempRecords.length >= 4) {
    const tempValues = tempRecords.map((r) => r.tempDeviation);
    const temp = { stddev: round(stddev(tempValues), 2) };
    const elevated = tempRecords.filter((r) => r.tempDeviation > 0.5);
    temp.elevationEvents = elevated.slice(-10).map((r) => ({ date: r.date, value: r.tempDeviation }));
    let runs = [];
    let current = [];
    for (const r of records) {
      if (r.tempDeviation !== undefined && r.tempDeviation > 0.5) {
        current.push(r.date);
      } else if (current.length) {
        if (current.length >= 2) runs.push({ start: current[0], end: current[current.length - 1], nights: current.length });
        current = [];
      }
    }
    if (current.length >= 2) runs.push({ start: current[0], end: current[current.length - 1], nights: current.length });
    temp.consecutiveElevationRuns = runs;
    patterns.temp = temp;
  }

  // ── 3E Strain vs recovery balance ─────────────────────────
  const loadField = records.some((r) => r.strain !== undefined) ? 'strain' : records.some((r) => r.trainingLoad !== undefined) ? 'trainingLoad' : null;
  if (loadField || baselines.averages.recoveryScore) {
    const strainRecovery = {};
    if (loadField) {
      const weeks = new Map();
      for (const r of records) {
        if (r[loadField] === undefined) continue;
        const weekKey = addDays(r.date, -((new Date(`${r.date}T00:00:00`).getDay() + 6) % 7));
        if (!weeks.has(weekKey)) weeks.set(weekKey, []);
        weeks.get(weekKey).push(r[loadField]);
      }
      const weekKeys = Array.from(weeks.keys()).sort();
      if (weekKeys.length >= 2) {
        const weekAvgs = weekKeys.map((k) => mean(weeks.get(k)));
        const first = weekAvgs[0];
        const last = weekAvgs[weekAvgs.length - 1];
        strainRecovery.weeklyLoadField = loadField;
        strainRecovery.weeklyChangePct = first ? round(((last - first) / first / (weekKeys.length - 1)) * 100, 1) : null;
        strainRecovery.weeklyAverages = weekKeys.map((k, i) => ({ week: k, avg: round(weekAvgs[i], 1) }));
      }
    }
    if (loadField && baselines.averages.recoveryScore) {
      const recoveryValues = records.filter((r) => r.recoveryScore !== undefined).map((r) => r.recoveryScore);
      const recoveryP33 = percentile(recoveryValues, 0.33);
      const loadValues = records.filter((r) => r[loadField] !== undefined).map((r) => r[loadField]);
      const loadMedian = percentile(loadValues, 0.5);
      const mismatches = records.filter(
        (r) => r.recoveryScore !== undefined && r[loadField] !== undefined && r.recoveryScore <= recoveryP33 && r[loadField] >= loadMedian
      );
      strainRecovery.recoveryMismatchDays = mismatches.map((r) => ({ date: r.date, recoveryScore: r.recoveryScore, [loadField]: r[loadField] }));
    }
    if (Object.keys(strainRecovery).length) patterns.strainRecovery = strainRecovery;
  }

  // ── 3F Stress ─────────────────────────────────────────────
  const stressRecords = records.filter((r) => r.stressScore !== undefined);
  if (stressRecords.length >= 4) {
    const stressValues = stressRecords.map((r) => r.stressScore);
    const stress = { trend: trendLabel(linregSlope(stressValues), 'points/week') };
    if (hrvRecords.length >= 4) {
      const stressVsNextHrv = pairedShift(records, dateMap, 'stressScore', 'hrv', 1);
      if (stressVsNextHrv.xs.length >= 4) stress.nextDayHrvCorrelation = round(correlation(stressVsNextHrv.xs, stressVsNextHrv.ys), 2);
    }
    patterns.stress = stress;
  }

  // ── 3G Behavioral tags ────────────────────────────────────
  const behavioral = {};
  if (records.some((r) => r.alcoholTag !== undefined) && hrvRecords.length) {
    behavioral.alcoholVsHrv = avgAfterTag(records, dateMap, 'alcoholTag', 'hrv', 1);
  }
  if (records.some((r) => r.alcoholTag !== undefined) && rhrRecords.length) {
    behavioral.alcoholVsRhr = avgAfterTag(records, dateMap, 'alcoholTag', 'rhr', 1);
  }
  if (records.some((r) => r.lateMealTag !== undefined) && rhrRecords.length) {
    behavioral.lateMealVsRhr = avgAfterTag(records, dateMap, 'lateMealTag', 'rhr', 1);
  }
  if (records.some((r) => r.caffeineTag !== undefined) && baselines.averages.sleepEfficiencyPct) {
    behavioral.caffeineVsSleepEfficiency = avgAfterTag(records, dateMap, 'caffeineTag', 'sleepEfficiencyPct', 0);
  }
  if (records.some((r) => r.travelTag !== undefined)) {
    behavioral.travelDays = records.filter((r) => r.travelTag).map((r) => r.date);
  }
  if (Object.keys(behavioral).length) patterns.behavioral = behavioral;

  return patterns;
}
