/**
 * Match & Interview Prep View
 * -----------------------------
 * Paste a job description, recruiter packet, or interview questions; ranks
 * the user's experiences by keyword overlap and drafts a tailored bullet
 * for each top match.
 *
 * TO EXTEND: `scoreExperienceAgainstText()` in utils.js is the one function
 * that does the actual matching — replace it with a real AI/embedding call
 * to upgrade from keyword overlap to semantic matching without touching
 * this view. `buildTailoredBullet()` below is the one function that drafts
 * the bullet text — same story.
 */

import { getAllExperiences } from '../state.js';
import { extractKeywords, scoreExperienceAgainstText, formatDateRange, escapeHtml } from '../utils.js';

const TOP_N = 8;

function buildTailoredBullet(exp, matchedKeywords) {
  const base = exp.refinedDescription || exp.originalDescription || exp.title;
  const highlight = matchedKeywords.slice(0, 4).join(', ');
  return highlight ? `${base} (relevant: ${highlight})` : base;
}

export function render(root) {
  const wrap = document.createElement('div');
  wrap.className = 'view';
  wrap.innerHTML = `
    <div class="view-header">
      <h1>Match Against a Job</h1>
    </div>
    <p class="muted">Paste a job description, recruiter packet, or interview questions below. Off-ramp surfaces your most relevant experiences and drafts a tailored bullet for each.</p>
    <textarea id="job-text" rows="8" placeholder="Paste the job description here…"></textarea>
    <button type="button" id="match-btn" class="btn">Find matching experiences</button>
    <div id="match-results"></div>
  `;
  root.appendChild(wrap);

  const resultsEl = wrap.querySelector('#match-results');

  wrap.querySelector('#match-btn').addEventListener('click', () => {
    const jobText = wrap.querySelector('#job-text').value;
    const keywords = extractKeywords(jobText);
    if (keywords.length === 0) {
      resultsEl.innerHTML = '<p class="empty-state">Paste some text first.</p>';
      return;
    }

    const scored = getAllExperiences()
      .map((exp) => ({ exp, ...scoreExperienceAgainstText(exp, keywords) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);

    if (scored.length === 0) {
      resultsEl.innerHTML =
        '<p class="empty-state">No overlapping keywords found. Try tagging more skills/tools on your experiences, or paste a more detailed description.</p>';
      return;
    }

    resultsEl.innerHTML = `<p class="muted">${scored.length} relevant experience${scored.length === 1 ? '' : 's'} found, ranked by keyword overlap:</p>`;
    for (const { exp, score, matched } of scored) {
      const card = document.createElement('article');
      card.className = 'experience-card';
      card.innerHTML = `
        <div class="experience-card-header">
          <div>
            <h3>${escapeHtml(exp.title) || '(untitled)'}</h3>
            <p class="muted">${escapeHtml(exp.organization)} · ${escapeHtml(formatDateRange(exp))} · match score ${score}</p>
          </div>
          <a href="#edit-${exp.id}">Open</a>
        </div>
        <p class="tailored-bullet">${escapeHtml(buildTailoredBullet(exp, matched))}</p>
        <div class="tag-list">${matched.map((k) => `<span class="tag tag-match">${escapeHtml(k)}</span>`).join('')}</div>
      `;
      resultsEl.appendChild(card);
    }
  });
}
