/**
 * Human-readable metadata for every canonical field fieldMapper.js can
 * produce. Single source of truth for labels/units/categories so
 * inventory.js, baselines.js, and the report renderer stay in sync.
 */
export const METRICS = {
  sleepTotalMin: { label: 'Total sleep duration', unit: 'min', category: 'Sleep' },
  sleepEfficiencyPct: { label: 'Sleep efficiency', unit: '%', category: 'Sleep' },
  sleepScore: { label: 'Sleep score / performance', unit: '', category: 'Sleep' },
  deepMin: { label: 'Deep sleep', unit: 'min', category: 'Sleep' },
  remMin: { label: 'REM sleep', unit: 'min', category: 'Sleep' },
  lightMin: { label: 'Light sleep', unit: 'min', category: 'Sleep' },
  awakeMin: { label: 'Awake time', unit: 'min', category: 'Sleep' },
  sleepLatencyMin: { label: 'Sleep latency', unit: 'min', category: 'Sleep' },
  disturbances: { label: 'Disturbances', unit: '', category: 'Sleep' },
  sleepDebtMin: { label: 'Sleep debt', unit: 'min', category: 'Sleep' },
  bedtime: { label: 'Bedtime', unit: '', category: 'Sleep' },
  waketime: { label: 'Wake time', unit: '', category: 'Sleep' },

  respiratoryRate: { label: 'Respiratory rate', unit: 'br/min', category: 'Cardio' },
  spo2Avg: { label: 'SpO2 (avg)', unit: '%', category: 'Cardio' },
  spo2Min: { label: 'SpO2 (min)', unit: '%', category: 'Cardio' },
  rhr: { label: 'Resting heart rate', unit: 'bpm', category: 'Cardio' },
  hrv: { label: 'HRV', unit: 'ms', category: 'Cardio' },

  recoveryScore: { label: 'Recovery / readiness score', unit: '', category: 'Recovery' },
  tempDeviation: { label: 'Body temperature deviation', unit: '°', category: 'Recovery' },
  skinTempC: { label: 'Skin temperature', unit: '°C', category: 'Recovery' },
  bodyBattery: { label: 'Body Battery', unit: '', category: 'Recovery' },
  stressScore: { label: 'Stress score', unit: '', category: 'Recovery' },

  steps: { label: 'Steps', unit: '', category: 'Activity' },
  activeCalories: { label: 'Active calories', unit: 'kcal', category: 'Activity' },
  totalCalories: { label: 'Total calories', unit: 'kcal', category: 'Activity' },
  strain: { label: 'Strain', unit: '', category: 'Activity' },
  trainingLoad: { label: 'Training load', unit: '', category: 'Activity' },
  workoutMinutes: { label: 'Workout duration', unit: 'min', category: 'Activity' },
  workoutCount: { label: 'Workouts', unit: '', category: 'Activity' },
  vo2max: { label: 'VO2 Max', unit: '', category: 'Activity' },

  alcoholTag: { label: 'Alcohol (logged)', unit: '', category: 'Behavioral' },
  caffeineTag: { label: 'Caffeine (logged)', unit: '', category: 'Behavioral' },
  travelTag: { label: 'Travel (logged)', unit: '', category: 'Behavioral' },
  lateMealTag: { label: 'Late meal (logged)', unit: '', category: 'Behavioral' },
  journalNote: { label: 'Journal / notes', unit: '', category: 'Behavioral' },
};

export const CATEGORY_ORDER = ['Sleep', 'Cardio', 'Recovery', 'Activity', 'Behavioral'];

/** Known device-specific quirks worth surfacing when the source is guessable from filenames/headers. */
export const DEVICE_NOTES = {
  oura: 'Oura reports body temperature as a deviation from your own rolling baseline, not an absolute reading — 0.0 is normal for you, not "no fever."',
  whoop: "Whoop organizes data by physiological cycle (sleep-to-sleep), not calendar day, so a given row's date may reflect when a cycle started rather than a strict midnight-to-midnight day.",
  garmin: 'Garmin Body Battery is a proprietary 0-100 fatigue/energy score, not a directly comparable metric across other platforms.',
  fitbit: 'Fitbit sleep stage minutes come from wrist-based estimation, which tends to be less precise on REM/deep boundaries than EEG-validated devices.',
};

export function guessDevice(fileNames, headers) {
  const haystack = [...fileNames, ...headers].join(' ').toLowerCase();
  if (/oura/.test(haystack)) return 'oura';
  if (/whoop/.test(haystack)) return 'whoop';
  if (/garmin/.test(haystack)) return 'garmin';
  if (/fitbit/.test(haystack)) return 'fitbit';
  return null;
}
