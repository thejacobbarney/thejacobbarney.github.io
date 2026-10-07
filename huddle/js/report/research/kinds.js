import { TRADE_PROMPT, WAIVER_PROMPT, LINEUP_PROMPT } from './prompts.js';
import { normalizeTrade, normalizeWaiver, normalizeLineup } from './normalize.js';

/** Decision types the live-search providers can research. */
export const RESEARCH_KINDS = {
  trade: { prompt: TRADE_PROMPT, normalize: normalizeTrade },
  waiver: { prompt: WAIVER_PROMPT, normalize: normalizeWaiver },
  lineup: { prompt: LINEUP_PROMPT, normalize: normalizeLineup },
};
