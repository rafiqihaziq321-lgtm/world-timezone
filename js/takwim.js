// The Takwim Islam section in the Malaysia tab: today's Hijri date (JAKIM's),
// the next holy days, the coming sunat fasts, which an .ics puts in a phone
// calendar with an alarm at imsak, and the Moon. Loaded the first time the
// tab is drawn.

import { downloadIcs, icsCalendar } from './calendar.js';
import { holidayRows } from './holidays.js';
import { sunatFasts, upcomingHolyDays } from './islamic-days.js';
import { zoneByCode } from './jakim-zones.js';
import { hijriParts, retryButton } from './local-panel.js';
import { moonPhase, moonTimes, nextPhase, phaseName } from './moon.js';
import { MAP_PLACES, placeName } from './places.js';
import { HOUR_MS, cityDate, formatClock } from './time.js';
import { el, renderKeyed } from './util.js';
import { HIJRI_MONTHS, zoneMonth } from './zones.js';

const KL = 'Asia/Kuala_Lumpur';
const DAY_MS = 86400000;
const SVG = 'http://www.w3.org/2000/svg';

const dayName = (iso, options) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ms-MY', { timeZone: 'UTC', ...options });
const hijriText = ({ day, month, year }) => `${day} ${HIJRI_MONTHS[month - 1]} ${year} H`;

// The zone's state capital, where the Moon is reckoned (Kuala Lumpur without a zone).
function moonPlace(code) {
  const zone = zoneByCode(code);
  const state = zone?.negeri === 'Wilayah Persekutuan' ? (code === 'WLY02' ? 'W.P. Labuan' : 'W.P. Kuala Lumpur') : zone?.negeri;
  return MAP_PLACES.find((p) => p.capital && p.state === state) ?? MAP_PLACES.find((p) => p.state === 'W.P. Kuala Lumpur');
}

export function renderTakwim(state, now) {
  state.holidaysWanted = true; // the holy days come from the public holiday table
  // JAKIM's Hijri date is the same in every zone; imsak and berbuka are the zone's own.
  const code = state.prayerZone ?? 'WLY01';
  const today = cityDate(KL, now);
  const following = today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 };
  const months = [today, following].map((m) => ({ ...m, ...zoneMonth(state, code, m.year, m.month) }));
  const rows = holidayRows(state);
  const key = [today.iso, code, state.prayerZone, ...months.map((m) => m.entry.status), rows !== null, state.hour24, Math.floor(now.getTime() / HOUR_MS)].join('|');
  renderKeyed(document.getElementById('takwim'), key, () => {
    const [first] = months;
    if (first.entry.status !== 'ok') {
      return [first.entry.status === 'error'
        ? el('p', 'local-status', 'Takwim JAKIM gagal dimuat. ')
        : el('p', 'local-status', 'Memuatkan takwim JAKIM…'), ...(first.entry.status === 'error' ? [retryButton(state, first.key)] : [])];
    }
    // From today to the end of next month, as far as JAKIM's times are loaded.
    const days = months.filter((m) => m.entry.status === 'ok').flatMap((m) => (m.entry.data.prayers ?? []).map((p) => {
      const iso = `${m.year}-${String(m.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      return { iso, p, hijri: hijriParts(p), weekday: new Date(`${iso}T00:00:00Z`).getUTCDay() };
    })).filter((d) => d.iso >= today.iso);
    return [todayBlock(days[0], today), holyBlock(rows, today), fastBlock(state, code, days), moonBlock(state, code, now, today)];
  });
}

function todayBlock(day, today) {
  const block = el('div', 'takwim-block takwim-today');
  block.append(el('h3', '', 'Hari ini'));
  if (day?.hijri.day) block.append(el('p', 'takwim-hijri', hijriText(day.hijri)));
  block.append(el('p', 'local-status', `${dayName(today.iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · takwim JAKIM`));
  return block;
}

function holyBlock(rows, today) {
  const block = el('div', 'takwim-block');
  block.append(el('h3', '', 'Hari kebesaran'));
  if (rows === null) {
    block.append(el('p', 'local-status', 'Memuatkan…'));
    return block;
  }
  const coming = upcomingHolyDays(rows, today.iso, 5);
  if (!coming.length) {
    block.append(el('p', 'local-status', 'Tiada tarikh lagi dalam jadual cuti umum.'));
    return block;
  }
  const wait = (iso) => Math.round((Date.parse(iso) - Date.parse(today.iso)) / DAY_MS);
  const [next, ...rest] = coming;
  const lead = el('p', 'takwim-next');
  lead.append(el('strong', '', next.name), wait(next.date) === 0 ? ' hari ini' : ` dalam ${wait(next.date)} hari`);
  block.append(lead, el('p', 'local-status', dayName(next.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })));
  const list = el('ul', 'takwim-list');
  for (const d of rest) {
    const item = el('li');
    item.append(el('span', '', d.name), el('span', '', `${dayName(d.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${wait(d.date)} hari`));
    list.append(item);
  }
  block.append(list, el('p', 'takwim-note', 'Tarikh ikut jadual cuti umum; tarikh rasmi diisytiharkan oleh Penyimpan Mohor Besar Raja-Raja.'));
  return block;
}

function fastBlock(state, code, days) {
  const block = el('div', 'takwim-block');
  block.append(el('h3', '', 'Puasa sunat'));
  const fasts = days.map((d) => ({ ...d, names: sunatFasts(d.hijri, d.weekday) })).filter((d) => d.names.length);
  if (!fasts.length) {
    block.append(el('p', 'local-status', 'Tiada puasa sunat hingga akhir bulan depan.'));
    return block;
  }
  const list = el('ul', 'takwim-list');
  for (const d of fasts.slice(0, 6)) {
    const item = el('li');
    item.append(el('span', '', d.names.join(', ')), el('span', '', `${dayName(d.iso, { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.hijri.day} ${HIJRI_MONTHS[d.hijri.month - 1]}`));
    list.append(item);
  }
  const ics = el('button', 'btn secondary');
  ics.type = 'button';
  ics.textContent = 'Muat turun .ics (penggera pada imsak)';
  ics.disabled = state.prayerZone === null;
  ics.addEventListener('click', () => {
    const zone = zoneByCode(code);
    const fmt = (s) => formatClock(state, KL, s * 1000);
    const events = fasts.filter((d) => d.p.imsak && d.p.maghrib).map((d) => ({
      uid: `${code}-${d.iso}-puasa@jam-dunia`,
      start: d.p.imsak * 1000,
      end: d.p.maghrib * 1000,
      title: `Puasa sunat: ${d.names.join(', ')}`,
      description: `${hijriText(d.hijri)}, zon ${code} (${zone.daerah}). Imsak ${fmt(d.p.imsak)}, berbuka ${fmt(d.p.maghrib)}. Dari Jam Dunia.`,
      alarm: true,
    }));
    downloadIcs(`puasa-sunat-${code}-${days[0].iso}.ics`, icsCalendar(events, Date.now()));
  });
  block.append(list, ics, el('p', 'takwim-note', state.prayerZone === null
    ? 'Pilih zon anda di atas untuk fail .ics dengan waktu imsak dan berbuka zon anda.'
    : `Hingga akhir bulan depan (JAKIM menyiarkan takwim sebulan demi sebulan). Setiap acara bermula pada imsak dan tamat pada waktu berbuka.`));
  return block;
}

function moonBlock(state, code, now, today) {
  const block = el('div', 'takwim-block takwim-moon');
  const { lit, phase } = moonPhase(now.getTime());
  const place = moonPlace(code);
  block.append(el('h3', '', 'Bulan'));
  const line = el('p', 'takwim-phase');
  const words = el('span');
  words.append(el('strong', '', phaseName(phase)), ` · ${Math.round(lit * 100)}% bercahaya`);
  line.append(moonPicture(phase), words);
  const fmtDay = (ms) => new Date(ms).toLocaleDateString('ms-MY', { timeZone: KL, weekday: 'short', day: 'numeric', month: 'short' });
  const coming = [[nextPhase(now.getTime(), 0), 'Bulan baharu'], [nextPhase(now.getTime(), 0.5), 'Purnama']]
    .filter(([ms]) => ms !== null).sort(([a], [b]) => a - b);
  const times = moonTimes(Date.parse(`${today.iso}T00:00:00+08:00`), place.lat, place.lon);
  const events = [[times.rise, 'terbit'], [times.set, 'terbenam']].filter(([ms]) => ms !== null).sort(([a], [b]) => a - b);
  block.append(
    line,
    el('p', '', coming.map(([ms, name]) => `${name}: ${fmtDay(ms)}`).join(' · ')),
    el('p', '', `Hari ini di ${placeName(place)}: ${events.length ? events.map(([ms, what]) => `${what} ${formatClock(state, KL, ms)}`).join(' · ') : 'bulan tidak terbit atau terbenam'}`),
    el('p', 'takwim-note', 'Dikira dalam pelayar ini; anak bulan untuk awal bulan Hijri ditentukan melalui rukyah dan hisab rasmi.'),
  );
  return block;
}

// The Moon as seen from Malaysia: lit from the right while waxing.
function moonPicture(phase) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('class', 'moon-picture');
  svg.setAttribute('aria-hidden', 'true');
  const disc = document.createElementNS(SVG, 'circle');
  disc.setAttribute('cx', '22');
  disc.setAttribute('cy', '22');
  disc.setAttribute('r', '20');
  disc.setAttribute('class', 'moon-dark');
  const cos = Math.cos(2 * Math.PI * phase);
  const waxing = phase < 0.5;
  const crescent = cos > 0;
  const lit = document.createElementNS(SVG, 'path');
  lit.setAttribute('d', `M22 2A20 20 0 0 ${waxing ? 1 : 0} 22 42A${(20 * Math.abs(cos)).toFixed(2)} 20 0 0 ${waxing === crescent ? 0 : 1} 22 2Z`);
  lit.setAttribute('class', 'moon-lit');
  svg.append(disc, lit);
  return svg;
}
