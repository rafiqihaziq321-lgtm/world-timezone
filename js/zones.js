// The viewer's own JAKIM prayer zone in the Malaysia tab: chosen from the
// list or found from their location, saved, and followed by the reminders.

import { downloadIcs, icsCalendar } from './calendar.js';
import { icon } from './icons.js';
import { JAKIM_ZONES, zoneByCode } from './jakim-zones.js';
import { PRAYER_TIMES, hijriParts, nextPrayer, retryButton } from './local-panel.js';
import { floodData, floodKey, floodMeter } from './floods.js';
import { calendarPath, prayerEvents } from './prayer-calendar.js';
import { locate, locationErrorText } from './qibla.js';
import { saveState } from './storage.js';
import { HOUR_MS, cityDate, formatClock, zonedTime } from './time.js';
import { el, fetchJson, renderKeyed } from './util.js';
import { activeWarnings, levelSegments, levelTag, levelWord, warningArea, worstNamedLevel } from './warnings.js';

export const ZONE_API = 'https://api.waktusolat.app';

// A zone's month of JAKIM times.
export function zoneMonth(state, code, year, month) {
  const key = `solat-zon|${code}|${year}-${month}`;
  return { key, entry: state.localData.get(key, `${ZONE_API}/v2/solat/${code}?year=${year}&month=${month}`) };
}

// Today's times in a zone; every zone keeps Malaysian time.
export function zonePrayerFor(state, code, now) {
  const { year, month, day } = cityDate('Asia/Kuala_Lumpur', now);
  const { key, entry } = zoneMonth(state, code, year, month);
  const today = entry.status === 'ok' && Array.isArray(entry.data?.prayers)
    ? entry.data.prayers.find((p) => p.day === day) ?? null
    : null;
  return { key, entry, today };
}

const selectEl = document.getElementById('zone-select');
const locateEl = document.getElementById('zone-locate');
const statusEl = document.getElementById('zone-status');
const timesEl = document.getElementById('zone-times');
const alertsEl = document.getElementById('zone-alerts');
const monthButtonEl = document.getElementById('zone-month');
const monthDialogEl = document.getElementById('month-dialog');
const monthTableEl = document.getElementById('month-table');
const monthIcsEl = document.getElementById('month-ics');

export const HIJRI_MONTHS = ['Muharam', 'Safar', 'Rabiulawal', 'Rabiulakhir', 'Jamadilawal', 'Jamadilakhir',
  'Rejab', 'Syaaban', 'Ramadan', 'Syawal', 'Zulkaedah', 'Zulhijah'];

// The states MET names for a zone (the Federal Territories one by one).
export function zoneStates(zone) {
  if (zone.code === 'WLY01') return ['W.P. Kuala Lumpur', 'W.P. Putrajaya'];
  if (zone.code === 'WLY02') return ['W.P. Labuan'];
  return [zone.negeri];
}

// "Kuala Lumpur dan Putrajaya": states as the reader says them.
export const stateList = (states) => states.map((s) => s.replace(/^W\.P\. /, '')).join(' dan ');

// "1j 40m" until `at` (epoch ms).
export function waitText(at, now) {
  const minutes = Math.ceil((at - now.getTime()) / 60000);
  return [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)}j`, minutes % 60 && `${minutes % 60}m`].filter(Boolean).join(' ') || 'kurang seminit';
}

// Other parts of the page (the reminders) follow the select's change event,
// so a zone found from the location is set by the same path as a chosen one.
function chooseZone(code) {
  selectEl.value = code;
  selectEl.dispatchEvent(new Event('change'));
}

export function setupZone(state) {
  const placeholder = new Option('Pilih zon…', '');
  selectEl.append(placeholder);
  for (const negeri of [...new Set(JAKIM_ZONES.map((z) => z.negeri))]) {
    const group = el('optgroup');
    group.label = negeri;
    for (const z of JAKIM_ZONES.filter((x) => x.negeri === negeri)) group.append(new Option(`${z.code} · ${z.daerah}`, z.code));
    selectEl.append(group);
  }
  selectEl.value = state.prayerZone ?? '';
  selectEl.addEventListener('change', () => {
    state.prayerZone = selectEl.value || null;
    if (state.prayerZone === null) state.reminder = false; // reminders need a zone
    saveState(state);
    state.refresh();
  });

  locateEl.addEventListener('click', () => {
    locateEl.disabled = true;
    statusEl.textContent = 'Mencari lokasi anda…';
    locate()
      // About 1 km is plenty to find a zone, and says less about where the viewer is.
      .then((here) => fetchJson(`${ZONE_API}/zones/${here.lat.toFixed(2)}/${here.lon.toFixed(2)}`).then((found) => {
        const zone = zoneByCode(found?.zone);
        if (!zone) throw new Error(`Zon tidak dikenali: ${found?.zone}`);
        return zone;
      }).then(
        (zone) => {
          chooseZone(zone.code);
          statusEl.textContent = `Zon anda: ${zone.code} (${zone.negeri}).`;
        },
        (err) => {
          console.info('Jam Dunia: zon solat tidak ditemui untuk lokasi ini.', err);
          statusEl.textContent = 'Zon JAKIM untuk lokasi anda tidak ditemui (mungkin di luar Malaysia, atau perkhidmatan gagal). Pilih zon daripada senarai.';
        },
      ), (err) => {
        console.info('Jam Dunia: lokasi tidak diperoleh.', err);
        statusEl.textContent = locationErrorText(err);
      })
      .finally(() => {
        locateEl.disabled = false;
      });
  });
}

// Today's times for the chosen zone, the next one marked.
export function renderZone(state, now) {
  const code = state.prayerZone;
  if (selectEl.value !== (code ?? '')) selectEl.value = code ?? '';
  monthButtonEl.disabled = code === null;
  renderZoneAlerts(state, now);
  if (monthDialogEl.open) renderMonth(state);
  if (code === null) {
    renderKeyed(timesEl, 'none', () => [el('p', 'local-status', 'Pilih zon anda, atau tekan “Guna lokasi saya”, untuk melihat waktu solat hari ini.')]);
    return;
  }
  const { key, entry, today } = zonePrayerFor(state, code, now);
  const next = nextPrayer(today, now);
  const minute = Math.floor(now.getTime() / 60000);
  renderKeyed(timesEl, [key, entry.status, today?.day, next, minute, state.hour24].join('|'), () => {
    if (entry.status === 'loading') return [el('p', 'local-status', 'Memuatkan…')];
    if (entry.status === 'error') return [el('p', 'local-status', 'Waktu solat gagal dimuat. '), retryButton(state, key)];
    if (!today) return [el('p', 'local-status', 'Tiada data untuk tarikh ini.')];
    // The zone is already named in the picker; the line above the times says what comes next.
    const list = el('ul', 'zone-times');
    for (const [field, label] of PRAYER_TIMES) {
      const past = today[field] && today[field] * 1000 <= now.getTime();
      const item = el('li', field === next ? 'next' : past ? 'done' : '');
      item.append(el('span', '', label), el('strong', '', today[field] ? formatClock(state, 'Asia/Kuala_Lumpur', today[field] * 1000) : 'tiada'));
      if (field === next) item.append(el('span', 'visually-hidden', ' (seterusnya)'));
      list.append(item);
    }
    const tomorrow = entry.data.prayers.find((p) => p.day === today.day + 1);
    const ahead = upcoming(state, today, tomorrow, next, now);
    const day = zoneDay(state, today, next, now);
    return ahead ? [ahead, day, list] : [day, list];
  });
}

// The zone's day as the sun strip (DESIGN.md, "Jalur zon"), its parts drawn
// from JAKIM's own times so the marks sit exactly on them: night until Subuh,
// dawn to Syuruk, day to Maghrib, dusk to Isyak, night again. Decorative: the
// same times are written in the list under it.
function zoneDay(state, today, next, now) {
  const { year, month, day } = cityDate('Asia/Kuala_Lumpur', now);
  const start = zonedTime('Asia/Kuala_Lumpur', year, month, day, 0, 0);
  const end = start + 24 * HOUR_MS; // Malaysia keeps no daylight saving
  const at = (field) => Math.min(end, Math.max(start, today[field] * 1000));
  const pct = (ms) => `${((ms - start) / (end - start)) * 100}%`;
  const box = el('div', 'zone-day');
  box.setAttribute('aria-hidden', 'true');
  const strip = el('div', 'sun-strip zone-strip');
  const runs = el('div', 'sun-runs');
  const edges = [start, at('fajr'), at('syuruk'), at('maghrib'), at('isha'), end];
  ['night', 'dawn', 'day', 'dusk', 'night'].forEach((phase, i) => {
    const run = el('span', phase);
    run.style.width = `${((edges[i + 1] - edges[i]) / (end - start)) * 100}%`;
    runs.append(run);
  });
  strip.append(runs);
  for (const [field, label] of PRAYER_TIMES) {
    if (!today[field]) continue;
    const ms = today[field] * 1000;
    const mark = el('span', `zone-mark${field === next ? ' next' : ms <= now.getTime() ? ' done' : ''}`);
    mark.style.left = pct(ms);
    if (field === next) {
      // The next one is named on the strip; the flag keeps inside the strip's ends.
      const share = (ms - start) / (end - start);
      const flag = el('span', `zone-flag${share < 0.15 ? ' start' : share > 0.85 ? ' end' : ''}`, `${label} ${formatClock(state, 'Asia/Kuala_Lumpur', ms)}`);
      mark.append(flag);
    }
    strip.append(mark);
  }
  const nowMark = el('span', 'sun-now');
  nowMark.style.left = pct(now.getTime());
  strip.append(nowMark);
  const axis = el('div', 'zone-axis');
  for (const h of [0, 6, 12, 18, 24]) axis.append(el('span', '', String(h).padStart(2, '0')));
  box.append(strip, axis);
  return box;
}

// "Zohor dalam 1j 40m (13:10)"; after Isyak, tomorrow's Subuh if the month holds it.
function upcoming(state, today, tomorrow, next, now) {
  const [field, day] = next ? [next, today] : tomorrow?.fajr ? ['fajr', tomorrow] : [];
  if (!field) return null;
  const wait = waitText(day[field] * 1000, now);
  const label = PRAYER_TIMES.find(([f]) => f === field)[1];
  // The tab's focal point: what comes next and how long until it.
  const line = el('p', 'zone-next');
  line.append(el('strong', '', `${label}${next ? '' : ' esok'}`), ' dalam ', el('span', 'zone-wait', wait), ' ',
    el('span', 'zone-at', `(${formatClock(state, 'Asia/Kuala_Lumpur', day[field] * 1000)})`));
  return line;
}

// The level meters for the zone's state (DESIGN.md): the worst level MET names,
// in segments and in words, then each warning in force linking to its card;
// then JPS's river stations above Normal there.
function renderZoneAlerts(state, now) {
  const zone = zoneByCode(state.prayerZone);
  const { entry, active } = activeWarnings(state, now);
  const states = zone ? zoneStates(zone) : [];
  const mine = active.filter((w) => warningArea(w).states.some((s) => states.includes(s)));
  const flood = floodData(state);
  const key = [zone?.code, entry.status, floodKey(state, flood.entry, states, now), ...mine.map((w) => `${w.warning_issue?.title_bm}|${w.valid_to}`)].join('|');
  renderKeyed(alertsEl, key, () => {
    if (!zone) return [];
    const rivers = flood.entry.status === 'ok' ? [floodMeter(state, flood.entry.data, states, stateList(states), now, 3)] : [];
    if (entry.status !== 'ok') return rivers;
    const level = worstNamedLevel(mine);
    const meter = el('div', `level-meter${mine.length ? '' : ' is-clear'}`);
    const head = el('p', 'level-head');
    const where = stateList(states);
    const words = el('span');
    words.append(el('strong', '', level ? levelWord(level) : mine.length ? 'Ada amaran' : 'Tiada amaran'), ` untuk ${where}`);
    head.append(levelSegments(level), words);
    if (mine.length && !level) head.append(el('span', 'level-none', ' · MET tidak menyatakan tahap'));
    meter.append(head);
    for (const w of mine) {
      const row = el('p', `zone-alert level-${warningArea(w).level}`);
      const more = el('a', '', 'Baca amaran');
      more.href = '#my-alerts-title';
      row.append(el('strong', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran MET'));
      const tag = levelTag(w);
      if (tag) row.append(tag);
      row.append(more);
      meter.append(row);
    }
    return [meter, ...rivers];
  });
}

// The month shown in the dialog, as "YYYY-MM" on the dialog itself.
function shownMonth() {
  const [year, month] = monthDialogEl.dataset.month.split('-').map(Number);
  return { year, month };
}

function renderMonth(state) {
  const zone = zoneByCode(state.prayerZone);
  if (!zone) return;
  const { year, month } = shownMonth();
  const { key, entry } = zoneMonth(state, zone.code, year, month);
  const today = cityDate('Asia/Kuala_Lumpur', new Date()).iso;
  document.getElementById('month-title').textContent = `Waktu solat ${new Date(year, month - 1, 1).toLocaleDateString('ms-MY', { month: 'long', year: 'numeric' })}`;
  document.getElementById('month-zone').textContent = `${zone.code} · ${zone.daerah}, ${zone.negeri}`;
  // The zone's calendar on this site, rebuilt daily (.github/workflows/pages.yml).
  const webcal = new URL(calendarPath(zone.code), document.baseURI).href.replace(/^https?:/, 'webcal:');
  document.getElementById('month-webcal').href = webcal;
  document.getElementById('month-google').href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  monthIcsEl.disabled = entry.status !== 'ok';
  renderKeyed(monthTableEl, [key, entry.status, state.hour24, today].join('|'), () => {
    if (entry.status !== 'ok') {
      const row = el('tbody').insertRow();
      const cell = row.insertCell();
      if (entry.status === 'error') cell.append(el('span', 'local-status', 'Waktu solat gagal dimuat. '), retryButton(state, key));
      else cell.append(el('span', 'local-status', 'Memuatkan…'));
      return [row.parentElement];
    }
    const columns = [['imsak', 'Imsak'], ...PRAYER_TIMES];
    const head = el('thead');
    const headRow = head.insertRow();
    for (const label of ['Tarikh', 'Hijri', ...columns.map(([, l]) => l)]) headRow.append(el('th', '', label));
    const body = el('tbody');
    for (const p of entry.data.prayers ?? []) {
      const row = body.insertRow();
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      if (iso === today) {
        row.className = 'today';
        row.setAttribute('aria-current', 'date');
      }
      const date = el('th', '', new Date(year, month - 1, p.day).toLocaleDateString('ms-MY', { weekday: 'short', day: 'numeric' }));
      date.scope = 'row';
      const hijri = hijriParts(p);
      row.append(date, el('td', '', hijri.day ? `${hijri.day} ${HIJRI_MONTHS[hijri.month - 1]}` : 'tiada'));
      for (const [field] of columns) row.append(el('td', '', p[field] ? formatClock(state, 'Asia/Kuala_Lumpur', p[field] * 1000) : 'tiada'));
    }
    return [head, body];
  });
}

// The month's five prayers as calendar events, each with a reminder at its time.
function monthCalendar(state) {
  const zone = zoneByCode(state.prayerZone);
  const { year, month } = shownMonth();
  const { entry } = zoneMonth(state, zone.code, year, month);
  return icsCalendar(prayerEvents(zone, year, month, entry.data.prayers ?? []), Date.now());
}

export function setupMonth(state) {
  const move = (months) => {
    const { year, month } = shownMonth();
    const d = new Date(year, month - 1 + months, 1);
    monthDialogEl.dataset.month = `${d.getFullYear()}-${d.getMonth() + 1}`;
    state.refresh();
  };
  monthButtonEl.addEventListener('click', () => {
    const { year, month } = cityDate('Asia/Kuala_Lumpur', new Date());
    monthDialogEl.dataset.month = `${year}-${month}`;
    monthDialogEl.showModal();
    state.refresh();
  });
  document.getElementById('month-prev').addEventListener('click', () => move(-1));
  document.getElementById('month-next').addEventListener('click', () => move(1));
  document.getElementById('month-print').addEventListener('click', () => window.print());
  monthIcsEl.addEventListener('click', () => {
    const { year, month } = shownMonth();
    downloadIcs(`waktu-solat-${state.prayerZone}-${year}-${String(month).padStart(2, '0')}.ics`, monthCalendar(state));
  });
}
