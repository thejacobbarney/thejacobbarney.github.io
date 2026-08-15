/**
 * Data Model
 * ----------
 * The single source of truth for the shape of every record the app stores.
 * Nothing here talks to localStorage or the DOM — it only defines what an
 * "Experience" or "Skill" record looks like and how to create one with
 * sane defaults.
 *
 * TO EXTEND THE MODEL:
 *   - Add a field by adding it to `createExperience()` (or `createSkill()`).
 *     Nothing else in the codebase hard-codes the field list, so most
 *     additions are a one-place change here plus a matching input in
 *     views/experienceForm.js.
 *   - Add a new experience TYPE by adding to `EXPERIENCE_TYPES`.
 *   - Add a new skill CATEGORY by adding to `SKILL_CATEGORIES`.
 */

import { generateId } from './utils.js';

export const EXPERIENCE_TYPES = [
  { value: 'job', label: 'Job / Role' },
  { value: 'project', label: 'Project' },
  { value: 'achievement', label: 'Achievement' },
  { value: 'process-improvement', label: 'Process Improvement' },
  { value: 'leadership', label: 'Leadership Moment' },
  { value: 'technical-deep-dive', label: 'Technical Deep-Dive' },
  { value: 'other', label: 'Other' },
];

export const SKILL_CATEGORIES = [
  { value: 'technical', label: 'Technical (Hard Skill)' },
  { value: 'soft', label: 'Soft Skill' },
  { value: 'domain', label: 'Domain Knowledge' },
  { value: 'tool', label: 'Tool / Technology' },
];

/** Fields on an Experience that hold arrays of skill/tool name strings. */
export const SKILL_LIST_FIELDS = ['skillsHard', 'skillsSoft', 'tools'];

/**
 * Creates a new Experience / Work Event record with defaults. Pass any
 * subset of fields to override; unspecified fields fall back to
 * empty/neutral defaults.
 *
 * `starSituation` / `starTask` / `starAction` / `starResult` back the
 * "Strengthen this experience" flow in views/experienceForm.js — they are
 * optional scratch fields used to assemble `refinedDescription`, which is
 * the field every other view (dashboard, match) actually reads.
 */
export function createExperience(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || generateId(),
    title: '',
    organization: '',
    startDate: '',
    endDate: '',
    isOngoing: false,
    type: 'job',
    originalDescription: '',
    refinedDescription: '',
    starSituation: '',
    starTask: '',
    starAction: '',
    starResult: '',
    metrics: '',
    skillsHard: [],
    skillsSoft: [],
    tools: [],
    tags: [],
    notes: '',
    linkedToResume: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Creates a new Skill/Tool record. Related experiences are NOT stored here
 * — they're computed on demand (see state.js's getExperiencesForSkill) by
 * scanning experiences for this skill's name, so the relationship never
 * goes stale when an experience is edited.
 */
export function createSkill(overrides = {}) {
  return {
    id: overrides.id || generateId(),
    name: '',
    category: 'technical',
    proficiency: '',
    notes: '',
    ...overrides,
  };
}

/** Returns an empty top-level data document — the shape persisted to storage. */
export function createEmptyDataset() {
  return {
    version: 1,
    experiences: [],
    skills: [],
  };
}
