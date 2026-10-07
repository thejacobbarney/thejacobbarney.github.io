/**
 * The "Other AI views" section and the final analysis, shared by My Team, Waivers and Trade.
 *
 * Claude's result stays the primary view in each tab. This renders, underneath it, a collapsible
 * section with one Run button and one result per other provider (Grok, Perplexity), and a "Compare
 * all AI views" step that has Claude write up the common themes and key differences across every
 * view that has been run. Results are kept per league fetch and per decision, so switching tabs
 * or re-rendering doesn't lose them, and a fresh fetch starts clean next to fresh numbers.
 */

import { escapeHtml } from '../utils.js';
import { renderSynthesisCard } from './researchCards.js';

// league object -> Map(decision key -> { results, open, synth: { sig, data } })
const stores = new WeakMap();

function entryFor(scope, key) {
  if (!stores.has(scope)) stores.set(scope, new Map());
  const map = stores.get(scope);
  if (!map.has(key)) map.set(key, { results: {}, open: false, synth: null });
  return map.get(key);
}

/**
 * @param {HTMLElement} container
 * @param {object} spec
 * @param {object} spec.scope           league object the results belong to
 * @param {string} spec.key             identifies the decision (e.g. the exact trade selection)
 * @param {string} spec.decision        short description for the final analysis ("a proposed trade")
 * @param {() => object|null} spec.getClaude   Claude's current result for this decision, or null
 * @param {() => boolean} spec.claudeReady     whether a Claude key is configured
 * @param {() => object} spec.getBrief         small JSON describing the decision
 * @param {{id:string,label:string,ready:()=>boolean,run:()=>Promise<object>,render:(res:object)=>string}[]} spec.providers
 * @param {(brief:object, views:object[]) => Promise<object>} spec.synthesize
 * @returns {{ refresh: () => void }}
 */
export function renderAiViews(container, spec) {
  const entry = entryFor(spec.scope, spec.key);

  function views() {
    const out = [];
    const claude = spec.getClaude();
    if (claude) out.push({ source: 'Claude', kind: 'offline-data', result: claude });
    for (const p of spec.providers) {
      const res = entry.results[p.id];
      if (res) out.push({ source: p.label, kind: 'live-search', result: res.data || { unstructured: res.rawText } });
    }
    return out;
  }

  function draw() {
    const available = views();
    const anyReady = spec.providers.some((p) => p.ready());
    const canSynth = available.length >= 2 && spec.claudeReady();
    const sig = JSON.stringify(available);
    const synthFresh = entry.synth && entry.synth.sig === sig;

    const actions = spec.providers
      .filter((p) => p.ready())
      .map(
        (p) =>
          `<button type="button" class="btn-ghost" data-run="${p.id}">${entry.results[p.id] ? 'Re-run' : 'Run'} ${escapeHtml(p.label)}</button>`
      )
      .join('');
    const runAll = spec.providers.filter((p) => p.ready()).length > 1
      ? '<button type="button" class="btn-ghost" data-run="all">Run all</button>'
      : '';
    const results = spec.providers
      .filter((p) => entry.results[p.id])
      .map(
        (p) =>
          `<details class="ai-view" open><summary>${escapeHtml(p.label)}</summary>${p.render(entry.results[p.id])}</details>`
      )
      .join('');

    let synthHint = '';
    if (!spec.claudeReady()) synthHint = 'Needs a Claude key (My Team tab) to write the final analysis.';
    else if (available.length < 2) synthHint = 'Run at least two AI views (Claude plus one other, or two others) to compare them.';

    container.innerHTML = `
      <details class="ai-views" ${entry.open ? 'open' : ''}>
        <summary>Other AI views <span class="muted small">· ${spec.providers.map((p) => escapeHtml(p.label)).join(', ')}</span></summary>
        <div class="ai-views-body">
          ${
            anyReady
              ? `<div class="row">${actions}${runAll}</div><span class="muted small ai-views-status"></span>`
              : '<p class="muted small">Add a Grok or Perplexity key on the My Team tab to get live-news second opinions here.</p>'
          }
          ${results}
        </div>
      </details>
      <div class="ai-final">
        <div class="ai-generate-row">
          <button type="button" class="btn" data-synth ${canSynth ? '' : 'disabled'}>Compare all AI views</button>
          <span class="muted small ai-final-status">${escapeHtml(synthHint)}</span>
        </div>
        ${entry.synth && !synthFresh ? '<p class="muted small">The views changed since the last comparison. Run it again to update it.</p>' : ''}
        ${synthFresh ? renderSynthesisCard(entry.synth.data) : ''}
      </div>`;

    container.querySelector('details.ai-views').addEventListener('toggle', (e) => {
      entry.open = e.target.open;
    });

    const statusEl = container.querySelector('.ai-views-status');
    const setStatus = (text, isError) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.className = `muted small ai-views-status${isError ? ' status-error' : ''}`;
    };

    container.querySelectorAll('[data-run]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const wanted = btn.dataset.run === 'all' ? spec.providers.filter((p) => p.ready()) : spec.providers.filter((p) => p.id === btn.dataset.run);
        container.querySelectorAll('[data-run]').forEach((b) => (b.disabled = true));
        setStatus(`Running ${wanted.map((p) => p.label).join(' and ')}…`, false);
        const outcomes = await Promise.allSettled(wanted.map((p) => p.run()));
        const errors = [];
        outcomes.forEach((o, i) => {
          if (o.status === 'fulfilled') entry.results[wanted[i].id] = o.value;
          else errors.push(`${wanted[i].label}: ${o.reason.message}`);
        });
        entry.open = true;
        draw();
        if (errors.length) {
          const el = container.querySelector('.ai-views-status');
          el.textContent = `✗ ${errors.join(' | ')}`;
          el.className = 'muted small ai-views-status status-error';
        }
      });
    });

    const synthBtn = container.querySelector('[data-synth]');
    synthBtn.addEventListener('click', async () => {
      const statusText = container.querySelector('.ai-final-status');
      synthBtn.disabled = true;
      statusText.textContent = 'Comparing…';
      statusText.className = 'muted small ai-final-status';
      try {
        const data = await spec.synthesize(spec.getBrief(), views());
        entry.synth = { sig: JSON.stringify(views()), data };
        draw();
        container.querySelector('.ai-final-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        synthBtn.disabled = false;
        statusText.textContent = `✗ ${err.message}`;
        statusText.className = 'muted small ai-final-status status-error';
      }
    });
  }

  draw();
  return { refresh: draw };
}
