// A time someone types — "3 petang Tokyo", "15:00 London esok", "9am New
// York Isnin" — read into a moment for the time slider. Loaded the first
// time the field is used.

import { findCity } from './search.js';
import { cityDate, formatClock, zonedTime } from './time.js';
import { normalizeName } from './util.js';

// Malay and English words for the part of the day, and the 24-hour hour they
// make of a 1–12 one. "2 malam" is two at night, "8 malam" eight in the evening.
const PERIODS = [
  [['tengah hari', 'tgh hari'], (h) => (h === 12 ? 12 : h + 12)],
  [['pagi', 'am', 'a.m.'], (h) => (h === 12 ? 0 : h)],
  [['petang', 'ptg', 'pm', 'p.m.'], (h) => (h === 12 ? 12 : h + 12)],
  [['malam', 'mlm'], (h) => (h === 12 ? 0 : h < 5 ? h : h + 12)],
];
const NAMED = [[['tengah malam', 'midnight'], 0], [['noon'], 12]];
const DAYS = [[['semalam', 'yesterday'], -1], [['hari ini', 'today'], 0], [['esok', 'tomorrow'], 1], [['lusa'], 2]];
const WEEKDAYS = [['ahad', 'sunday'], ['isnin', 'monday'], ['selasa', 'tuesday'], ['rabu', 'wednesday'], ['khamis', 'thursday'], ['jumaat', 'friday'], ['sabtu', 'saturday']];
const FILLERS = ['pukul', 'pkl', 'jam', 'di', 'pada', 'at', 'in', 'on', 'waktu'];

const escape = (w) => w.replace(/[.]/g, '\\.');

// The parts of the text: { hour, minute, dayShift, weekday, place }, or { error }.
export function parseTimeQuery(text) {
  let rest = ` ${normalizeName(text).replace(/,/g, ' ')} `;
  const take = (words) => {
    for (const word of words) {
      const re = new RegExp(`(\\s|\\d)${escape(word)}(?=\\s)`);
      if (re.test(rest)) {
        rest = rest.replace(re, '$1 ');
        return true;
      }
    }
    return false;
  };
  const named = NAMED.find(([words]) => take(words)); // before "malam" can take "tengah malam"
  const period = PERIODS.find(([words]) => take(words));
  const day = DAYS.find(([words]) => take(words));
  const weekday = WEEKDAYS.findIndex((words) => take(words));
  for (const word of FILLERS) rest = rest.replace(new RegExp(`\\s${word}(?=\\s)`, 'g'), ' ');
  const match = rest.match(/\s(\d{1,2})(?:[:.](\d{2}))?(?=\s)/);
  let hour;
  let minute = 0;
  if (match) {
    rest = rest.replace(match[0], ' ');
    hour = Number(match[1]);
    minute = match[2] === undefined ? 0 : Number(match[2]);
    if (period) {
      if (hour < 1 || hour > 12) return { error: `"${match[1]}" bukan jam 1–12 untuk ${period[0][0]}.` };
      hour = period[1](hour);
    }
  } else if (named) {
    hour = named[1];
  } else if (period?.[0][0] === 'tengah hari') {
    hour = 12;
  } else {
    return { error: 'Tiada jam dalam teks itu. Cuba "3 petang Tokyo" atau "15:00 London".' };
  }
  if (hour > 23 || minute > 59) return { error: 'Jam itu tidak wujud. Cuba "15:30" atau "3.30 petang".' };
  return { hour, minute, dayShift: day ? day[1] : 0, weekday: weekday === -1 ? null : weekday, place: rest.replace(/\s+/g, ' ').trim() };
}

// The moment the text names, with a sentence saying so, or { error }. The
// place is looked for in the reader's cards first, then in the city list.
export async function resolveTimeQuery(text, { state, loadCityList, now, localZone }) {
  const q = parseTimeQuery(text);
  if (q.error) return q;
  let city = null;
  if (q.place) {
    const key = normalizeName(q.place);
    city = state.cities.find((c) => normalizeName(c.name) === key) ?? state.cities.find((c) => normalizeName(c.name).startsWith(key))
      ?? findCity(await loadCityList(), q.place);
    if (!city) return { error: `Bandar "${q.place}" tidak dijumpai.` };
  }
  const zone = city ? city.zone : localZone;
  const today = cityDate(zone, new Date(now));
  const weekdayToday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const shift = q.weekday === null ? q.dayShift : (q.weekday - weekdayToday + 7) % 7;
  const ms = zonedTime(zone, today.year, today.month, today.day + shift, q.hour, q.minute);
  const there = `${formatClock(state, zone, ms)} ${new Date(ms).toLocaleDateString('ms-MY', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })}`;
  return {
    ms,
    message: city ? `${there} di ${city.name} = ${formatClock(state, localZone, ms)} waktu anda` : `${there} waktu anda`,
  };
}
