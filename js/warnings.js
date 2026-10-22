// MET Malaysia warnings in force, and the states they cover.

import { parseMyt } from './time.js';

export const WARNING_API = 'https://api.data.gov.my/weather/warning';
// MET warnings in force at `now`, shared by the Malaysia tab and the map.
export function activeWarnings(state, now) {
  const key = 'amaran';
  const entry = state.localData.get(key, `${WARNING_API}?sort=-warning_issue__issued&limit=20`);
  // MET reissues warnings unchanged, so show each title and text once.
  const seen = new Set();
  const active = (entry.status === 'ok' && Array.isArray(entry.data) ? entry.data : [])
    .filter((w) => !(parseMyt(w.valid_to) < now.getTime()))
    .filter((w) => {
      const id = `${w.warning_issue?.title_bm || w.heading_bm}|${w.text_bm}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return { key, entry, active };
}

// How a warning's states are named in MET's text.
export const WARNING_STATE_NAMES = [
  ['Johor', /\bJohor\b/i], ['Kedah', /\bKedah\b/i], ['Kelantan', /\bKelantan\b/i],
  ['Melaka', /\b(Melaka|Malacca)\b/i], ['Negeri Sembilan', /\bNegeri Sembilan\b/i], ['Pahang', /\bPahang\b/i],
  ['Perak', /\bPerak\b/i], ['Perlis', /\bPerlis\b/i], ['Pulau Pinang', /\b(Pulau Pinang|Penang)\b/i],
  ['Sabah', /\bSabah\b/i], ['Sarawak', /\bSarawak\b/i], ['Selangor', /\bSelangor\b/i],
  ['Terengganu', /\bTerengganu\b/i], ['W.P. Kuala Lumpur', /\bKuala Lumpur\b/i],
  ['W.P. Labuan', /\bLabuan\b/i], ['W.P. Putrajaya', /\bPutrajaya\b/i],
];
export const WARNING_LEVELS = { alert: 'Amaran', severe: 'Buruk', danger: 'Bahaya' };

// The states a land warning covers, and how severe it is. Warnings for the
// sea ("laut bergelora", "perairan") name states only to locate the water,
// so they colour nothing.
export function warningArea(w) {
  const title = `${w.warning_issue?.title_bm ?? ''} ${w.heading_bm ?? ''}`;
  if (/laut|ombak|perairan/i.test(title)) return { states: [], level: null };
  const states = WARNING_STATE_NAMES.filter(([, pattern]) => pattern.test(w.text_bm ?? '')).map(([name]) => name);
  const level = /bahaya/i.test(title) ? 'danger' : /buruk/i.test(title) ? 'severe' : 'alert';
  return { states, level };
}

// The worst level of warning in force for each state.
export function warningLevels(active) {
  const rank = { alert: 1, severe: 2, danger: 3 };
  const levels = {};
  for (const w of active) {
    const { states, level } = warningArea(w);
    for (const name of states) if (!levels[name] || rank[level] > rank[levels[name]]) levels[name] = level;
  }
  return levels;
}

// MET warnings name every affected district after "kawasan berikut:", which
// can run to hundreds of words; the lead clause says what and when.
export function warningSummary(text, max = 160) {
  const colon = text.search(/(?<!\d):(?!\d)/); // not the colon in "6:00 petang"
  let lead = (colon > 0 ? text.slice(0, colon) : text.split(/(?<=\.)\s/)[0]).trim();
  if (lead.length > max) {
    const space = lead.lastIndexOf(' ', max - 1);
    lead = `${lead.slice(0, space > 0 ? space : max - 1)}…`;
  }
  return lead;
}
