// JPS river levels: the stations above their Normal threshold, state by state,
// from data/banjir.json (written every 30 minutes by scripts/build-banjir.mjs,
// since JPS lets no browser read its tables directly).

import { HOUR_MS, formatClock } from './time.js';
import { el } from './util.js';
import { levelSegments } from './warnings.js';

export const FLOOD_URL = 'data/banjir.json';
const STALE_MS = 3 * HOUR_MS;
const RANK = { waspada: 1, amaran: 2, bahaya: 3 };
const WORDS = { waspada: 'Waspada', amaran: 'Amaran', bahaya: 'Bahaya' };
// JPS's three levels drawn with MET's segments and colours (DESIGN.md, "Tahap amaran").
const AS_MET = { waspada: 'alert', amaran: 'severe', bahaya: 'danger' };

export function floodData(state) {
  const key = 'banjir';
  return { key, entry: state.localData.get(key, FLOOD_URL) };
}

// The stations above Normal in states `names`, worst first, or null when JPS
// gave none of those states (Labuan has no table; a state may be missing).
export function floodStations(data, names) {
  const known = names.filter((n) => data?.states?.[n]);
  if (!known.length) return null;
  return known.flatMap((n) => data.states[n].above.map((s) => ({ ...s, state: n })))
    .sort((a, b) => RANK[b.level] - RANK[a.level]);
}

export const worstFlood = (stations) => stations?.[0]?.level ?? null;
export const floodWord = (level) => WORDS[level];

// "103.19 m" in Malay figures.
const metres = (value) => `${value.toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;

function stationRow(state, s) {
  const row = el('li', 'flood-station');
  const where = el('span', 'flood-where');
  where.append(el('strong', '', s.name), s.district ? `, ${s.district}` : '');
  // The level in words, then the reading against the threshold it has passed, so it can be checked.
  const reading = el('span', 'flood-reading');
  reading.append(el('strong', '', `${WORDS[s.level]}:`), ` ${metres(s.wl)} (ambang ${metres(s.thresholds[s.level])})`);
  const at = Date.parse(s.at);
  if (Number.isFinite(at)) reading.append(`, ${formatClock(state, 'Asia/Kuala_Lumpur', at)}`);
  row.append(levelSegments(AS_MET[s.level]), where, reading);
  return row;
}

// When JPS last gave the figures for states `names` (the oldest of them).
function readAt(data, names) {
  const times = names.map((n) => Date.parse(data?.states?.[n]?.fetched)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : Date.parse(data?.built);
}

// What a drawn meter depends on, so it is redrawn only when that changes
// (an opened "stesen lagi" stays open).
export function floodKey(state, entry, names, now) {
  const at = entry.status === 'ok' ? readAt(entry.data, names) : null;
  return [entry.status, at, state.hour24, at !== null && now.getTime() - at > STALE_MS].join('|');
}

// Where the figures come from and when JPS last gave them; older than 3 hours
// (a missed build) is said plainly.
function sourceLine(state, data, names, now) {
  const at = readAt(data, names);
  const line = el('p', 'flood-source');
  const link = el('a', '', 'JPS');
  link.href = 'https://publicinfobanjir.water.gov.my/';
  link.rel = 'noopener';
  link.target = '_blank';
  const when = new Date(at).toLocaleString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
  if (now.getTime() - at > STALE_MS) {
    line.classList.add('is-stale');
    line.append('Data ', link, ` lebih 3 jam lalu (${when}); semak laman JPS untuk bacaan terkini.`);
  } else {
    line.append('Aras sungai ', link, `, dikemas kini ${formatClock(state, 'Asia/Kuala_Lumpur', at)}.`);
  }
  return line;
}

// The river levels for states `names` as a level meter: the worst level and
// how many stations, then each station, `max` at most before the rest fold.
export function floodMeter(state, data, names, where, now, max) {
  const stations = floodStations(data, names);
  const meter = el('div', `level-meter flood-meter${stations?.length ? '' : ' is-clear'}`);
  const head = el('p', 'level-head');
  const level = worstFlood(stations);
  const words = el('span');
  const read = names.reduce((n, name) => n + (data?.states?.[name]?.stations ?? 0), 0);
  if (!stations) words.append(`Tiada data aras sungai JPS untuk ${where}`);
  else if (!stations.length) words.append(el('strong', '', 'Aras sungai normal'), ` di ${where} (${read} stesen JPS)`);
  else words.append(el('strong', '', WORDS[level]), ` aras sungai di ${stations.length} daripada ${read} stesen JPS, ${where}`);
  head.append(levelSegments(level ? AS_MET[level] : null), words);
  meter.append(head);
  if (stations?.length) {
    const list = el('ul', 'flood-stations');
    list.append(...stations.slice(0, max).map((s) => stationRow(state, s)));
    meter.append(list);
    if (stations.length > max) {
      const rest = el('details', 'flood-more');
      const more = el('ul', 'flood-stations');
      more.append(...stations.slice(max).map((s) => stationRow(state, s)));
      rest.append(el('summary', '', `${stations.length - max} stesen lagi`), more);
      meter.append(rest);
    }
  }
  if (stations) meter.append(sourceLine(state, data, names, now));
  return meter;
}
