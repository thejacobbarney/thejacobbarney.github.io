/**
 * In-memory store + pub/sub. This is the ONLY module views should import to
 * read or mutate data — it wraps storage.js so every view stays decoupled
 * from *how* data is persisted (see storage.js's header comment for the
 * backend-swap path).
 *
 * TO EXTEND: add a new CRUD method here following the existing pattern
 * (mutate `data`, call `persistAndNotify()`), rather than reaching into
 * storage.js or localStorage from a view.
 */

import { loadData, saveData } from './storage.js';
import { createExperience, createSkill, SKILL_LIST_FIELDS } from './data-model.js';

let data = loadData();
const subscribers = [];

/** Registers a callback fired after every mutation. Returns an unsubscribe function. */
export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

function notify() {
  subscribers.forEach((fn) => fn(data));
}

function persistAndNotify() {
  saveData(data);
  notify();
}

/** Ensures every skill/tool name referenced on an experience exists as a Skill record. */
function autoRegisterSkills(experience) {
  const categoryByField = { skillsHard: 'technical', skillsSoft: 'soft', tools: 'tool' };
  for (const field of SKILL_LIST_FIELDS) {
    for (const name of experience[field] || []) {
      const exists = data.skills.some((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!exists) {
        data.skills.push(createSkill({ name, category: categoryByField[field] }));
      }
    }
  }
}

// ── Experiences ────────────────────────────────────────────────────────

export function getAllExperiences() {
  return data.experiences;
}

export function getExperience(id) {
  return data.experiences.find((e) => e.id === id) || null;
}

export function addExperience(fields) {
  const exp = createExperience(fields);
  data.experiences.push(exp);
  autoRegisterSkills(exp);
  persistAndNotify();
  return exp;
}

export function updateExperience(id, fields) {
  const idx = data.experiences.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const updated = { ...data.experiences[idx], ...fields, id, updatedAt: new Date().toISOString() };
  data.experiences[idx] = updated;
  autoRegisterSkills(updated);
  persistAndNotify();
  return updated;
}

export function deleteExperience(id) {
  data.experiences = data.experiences.filter((e) => e.id !== id);
  persistAndNotify();
}

// ── Skills / Tools ─────────────────────────────────────────────────────

export function getAllSkills() {
  return data.skills;
}

/**
 * Creates a skill, or updates one if it already exists — matched by `id`
 * when given, otherwise by a case-insensitive name match. The name-match
 * fallback means "add" is idempotent by name: tagging/importing a skill
 * that's already in the inventory updates it in place instead of creating
 * a duplicate entry.
 */
export function upsertSkill(fields) {
  const existing = fields.id
    ? data.skills.find((s) => s.id === fields.id)
    : fields.name
      ? data.skills.find((s) => s.name.toLowerCase() === fields.name.toLowerCase())
      : null;
  if (existing) {
    Object.assign(existing, fields);
  } else {
    data.skills.push(createSkill(fields));
  }
  persistAndNotify();
}

export function deleteSkill(id) {
  data.skills = data.skills.filter((s) => s.id !== id);
  persistAndNotify();
}

/**
 * Returns experiences that reference the given skill name in any of their
 * skill/tool/tag fields. This computes the Skill↔Experience many-to-many
 * relationship on demand instead of storing it redundantly, so it can never
 * go stale when an experience is edited.
 */
export function getExperiencesForSkill(skillName) {
  const needle = skillName.toLowerCase();
  return data.experiences.filter((e) =>
    [...e.skillsHard, ...e.skillsSoft, ...e.tools, ...e.tags].some((s) => s.toLowerCase() === needle)
  );
}

// ── Whole-dataset operations (export/import) ───────────────────────────

export function getDataset() {
  return data;
}

export function replaceDataset(newData) {
  data = newData;
  persistAndNotify();
}
