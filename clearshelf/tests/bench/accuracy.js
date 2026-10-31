/*
 * Accuracy benchmark. Runs the real engine in Chromium over a seeded corpus and reports
 * precision, recall and organic preservation per condition.
 *
 *   node tests/bench/accuracy.js [pages=240] [--json out.json]
 *
 * Ground truth is authored by the fixtures themselves, so this measures consistency against
 * the modelled markup, not accuracy on live Amazon. See docs/TESTING.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../fixtures/corpus.js');
const H = require('../harness.js');

const CONDITIONS = [
  { id: 'baseline-balanced', label: 'Baseline markup, Balanced', transform: (h) => h, settings: { mode: 'balanced' } },
  { id: 'baseline-strict', label: 'Baseline markup, Strict', transform: (h) => h, settings: { mode: 'strict' } },
  { id: 'baseline-aggressive', label: 'Baseline markup, Aggressive', transform: (h) => h, settings: { mode: 'aggressive' } },
  { id: 'drift-classes', label: 'All CSS classes renamed, Balanced', transform: C.scrambleClasses, settings: { mode: 'balanced' } },
  { id: 'drift-hostile', label: 'Classes and data attributes removed, Balanced', transform: C.hostile, settings: { mode: 'balanced' } },
];

async function runCondition(cond, seeds) {
  const total = { tp: 0, fp: 0, fn: 0, tn: 0, byVariant: {}, falsePos: {} };
  let protectedHits = 0;
  let unresolved = 0;
  for (const seed of seeds) {
    const page = C.generatePage(seed);
    const res = await H.runEngine(cond.transform(page.html), { settings: cond.settings, pageType: page.pageType, path: page.path });
    const s = H.score(res.units);
    total.tp += s.tp; total.fp += s.fp; total.fn += s.fn; total.tn += s.tn;
    protectedHits += res.protectedHidden.length;
    unresolved += res.report.snapshot.unresolved;
    for (const u of res.units) {
      if (u.truth !== 'sponsored') continue;
      const v = (total.byVariant[u.variant] = total.byVariant[u.variant] || { n: 0, hit: 0 });
      v.n++; if (u.hidden) v.hit++;
    }
    for (const v of s.falsePos) total.falsePos[v] = (total.falsePos[v] || 0) + 1;
  }
  const sponsored = total.tp + total.fn;
  const organic = total.fp + total.tn;
  return {
    id: cond.id, label: cond.label, pages: seeds.length, sponsored, organic,
    tp: total.tp, fp: total.fp, fn: total.fn,
    precision: total.tp + total.fp ? total.tp / (total.tp + total.fp) : 1,
    recall: sponsored ? total.tp / sponsored : 1,
    organicPreserved: organic ? total.tn / organic : 1,
    protectedHidden: protectedHits, unresolvedLabels: unresolved,
    byVariant: total.byVariant, falsePosVariants: total.falsePos,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const pages = parseInt(args.find((a) => /^\d+$/.test(a)) || '240', 10);
  const jsonIdx = args.indexOf('--json');
  const seeds = Array.from({ length: pages }, (_, i) => 1000 + i);
  const results = [];
  for (const c of CONDITIONS) {
    const r = await runCondition(c, seeds);
    results.push(r);
    console.log(`${c.label.padEnd(50)} sponsored=${r.sponsored} organic=${r.organic}  precision=${(r.precision * 100).toFixed(2)}%  recall=${(r.recall * 100).toFixed(2)}%  organic-preserved=${(r.organicPreserved * 100).toFixed(2)}%  FP=${r.fp}`);
  }
  if (jsonIdx >= 0) fs.writeFileSync(args[jsonIdx + 1], JSON.stringify({ pages, results }, null, 2));
  await H.closeBrowser();
  return results;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { main, CONDITIONS, runCondition };
