// MET Malaysia warnings in force, and the states they cover.

import { parseMyt } from './time.js';
import { el } from './util.js';

export const WARNING_API = 'https://api.data.gov.my/weather/warning';
// MET warnings in force at `now`, shared by the Malaysia tab and the map.
export function activeWarnings(state, now) {
  const key = 'amaran';
  const entry = state.localData.get(key, `${WARNING_API}?sort=-warning_issue__issued&limit=20`);
  // MET reissues warnings unchanged, so show each title and text once.
  const seen = new Set();
  const active = (entry.status === 'ok' && Array.isArray(entry.data) ? entry.data : [])
    .filter((w) => !(parseMyt(w.valid_to) < now.getTime()))
    // "Tiada Nasihat": MET's cyclone bulletin saying there is none. Not a warning, and it never expires.
    .filter((w) => !/^tiada\b/i.test((w.warning_issue?.title_bm || w.heading_bm || '').trim()))
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
// MET's own words for each level, shown as a text label on a warning (not a colour stripe).
const LEVEL_WORDS = { alert: 'Waspada', severe: 'Buruk', danger: 'Bahaya' };

// "Tahap: Bahaya" as a small label for warning `w`, only where MET names the
// level in its title or heading (a thunderstorm or sea warning names none).
export function levelTag(w) {
  const { level } = warningArea(w);
  const named = /waspada|buruk|bahaya/i.test(`${w.warning_issue?.title_bm ?? ''} ${w.heading_bm ?? ''}`);
  if (!level || !named) return null;
  const tag = el('span', `level-tag level-${level}`, LEVEL_WORDS[level]);
  tag.prepend(el('span', 'visually-hidden', 'Tahap: '));
  return tag;
}

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

// Splits `s` on any of `seps` (single characters, or ' dan ') outside brackets.
function splitOutside(s, seps) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    const sep = depth === 0 && seps.find((x) => s.startsWith(x, i));
    if (sep) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/\.$/, '').trim()).filter(Boolean);
}

// The state a leading name stands for ("Kelantan", "negeri Sabah"), or null.
function stateNamed(name) {
  const named = (text) => WARNING_STATE_NAMES.find(([, pattern]) => new RegExp(`^${pattern.source}$`, 'i').test(text))?.[0] ?? null;
  // As written first: "Negeri Sembilan" is a state, not "negeri" + "Sembilan".
  return named(name.trim()) ?? named(name.replace(/^(negeri|Wilayah Persekutuan|W\.\s?P\.?)\s+/i, '').trim());
}

// "Sandakan (Paitan, Telupid)" as { name: 'Sandakan', within: ['Paitan', 'Telupid'] }.
function place(text) {
  const m = text.match(/^([^()]+?)\s*\((.*)\)$/s);
  return m ? { name: m[1].trim(), within: splitOutside(m[2], [',', ' dan ']) } : { name: text, within: [] };
}

// The places a MET warning names, read from its usual wording, e.g.
//   "I) ... di negeri Kelantan (Tanah Merah, Kota Bharu) • Terengganu (Besut) dalam tempoh Ahad ... II) ... di negeri Sabah: Kudat, Sandakan (Paitan) ..."
//   "... sehingga jam 6:00 petang di kawasan berikut: Perak (Kinta); Pahang (Raub)."
// as [{ period, areas: [{ state, places: [{ name, within }] }] }]; an area
// with no places means the whole state. Null when any part does not read
// that way, so the card falls back to MET's own text.
export function warningPlaces(text) {
  const body = String(text ?? '').replace(/^[^()]*\((?:WASPADA|BURUK|BAHAYA)\)\s*/i, '');
  const sections = [];
  for (const part of body.split(/(?:^|\s)[IVX]+\)\s+/).map((s) => s.trim()).filter(Boolean)) {
    const where = part.match(/\bdi (?:negeri-negeri |negeri |kawasan berikut:\s*|kawasan )?(.+?)(?:\s+(dalam tempoh|sehingga)\s+(.+?))?\.?$/s);
    if (!where) return null;
    const after = where[2] === 'sehingga' ? `sehingga ${where[3]}` : where[3];
    const period = after ?? part.match(/\b(sehingga [^.]+?)\s+di\b/)?.[1] ?? '';
    const areas = [];
    for (const segment of splitOutside(where[1], ['•', ';', ',', ' dan '])) {
      const head = segment.match(/^([^():]+?)\s*(?:\((.*)\)|:\s*(.*))?$/s);
      const state = head && stateNamed(head[1]);
      if (state) {
        const list = head[2] ?? head[3];
        areas.push({ state, places: list ? splitOutside(list, [',', ' dan ']).map(place) : [] });
      } else if (areas.length && areas.at(-1).open) {
        areas.at(-1).places.push(place(segment)); // "Sabah: Kudat, Sandakan (...)": the list runs on after the colon
      } else {
        return null;
      }
      if (state) areas.at(-1).open = head[3] !== undefined;
    }
    if (!areas.length) return null;
    sections.push({ period, areas: areas.map(({ state, places }) => ({ state, places })) });
  }
  return sections.length ? sections : null;
}

// MET's CAPITALS as a sentence: "UNTUK PERAIRAN MALAYSIA [DALAM ...]" -> "Untuk perairan Malaysia (dalam ...)".
function sentence(caps) {
  const s = caps.toLowerCase().replace(/\[/g, '(').replace(/\]/g, ')').replace(/\bmalaysia\b/g, 'Malaysia').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A sea warning (strong winds, rough seas, storms at sea), read from MET's usual wording:
//   "SEKSYEN A: UNTUK PERAIRAN MALAYSIA [...] 1) AMARAN RIBUT PETIR Ribut petir ... di kawasan perairan
//    Perlis & Kedah • Pulau Pinang sehingga 10:00 Malam; Sabtu, 7 November 2026. Keadaan ini ... SEKSYEN B: ..."
// as [{ heading, items: [{ title, period, waters, impact }] }]. Null when any part does not read that way.
export function seaWarningParts(text) {
  const body = String(text ?? '');
  if (!/SEKSYEN [A-Z]:/.test(body)) return null;
  const sections = [];
  for (const chunk of body.split(/(?=SEKSYEN [A-Z]:)/).map((s) => s.trim()).filter(Boolean)) {
    const head = chunk.match(/^SEKSYEN [A-Z]:\s*(.*?)\s+(?=1\)\s)/s);
    if (!head) return null;
    const items = [];
    for (const part of chunk.slice(head[0].length).split(/(?:^|\s)\d+\)\s+/).map((s) => s.trim()).filter(Boolean)) {
      const title = part.match(/^([^a-z]+?)\s+(?=[A-Z][a-z])/)?.[1];
      const where = part.match(/\bdi kawasan perairan (.+?)\s+(dalam tempoh|sehingga)\s+(.+?)\.(?:\s|$)/s);
      if (!title || !where) return null;
      items.push({
        title: sentence(title.replace(/^AMARAN\s+/, '')),
        period: where[2] === 'sehingga' ? `sehingga ${where[3]}` : where[3],
        waters: splitOutside(where[1], ['•']),
        impact: part.slice(where.index + where[0].length).trim(),
      });
    }
    if (!items.length) return null;
    sections.push({ heading: sentence(head[1]), items });
  }
  return sections;
}
