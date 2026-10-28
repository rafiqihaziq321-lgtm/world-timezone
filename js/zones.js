// The viewer's own JAKIM prayer zone in the Malaysia tab: chosen from the
// list or found from their location, saved, and followed by the reminders.

import { downloadIcs, icsCalendar } from './calendar.js';
import { icon } from './icons.js';
import { JAKIM_ZONES, zoneByCode } from './jakim-zones.js';
import { PRAYERS, PRAYER_TIMES, hijriParts, nextPrayer, retryButton } from './local-panel.js';
import { locate, locationErrorText } from './qibla.js';
import { saveState } from './storage.js';
import { cityDate, formatClock } from './time.js';
import { el, fetchJson, renderKeyed } from './util.js';
import { activeWarnings, warningArea } from './warnings.js';

export const ZONE_API = 'https://api.waktusolat.app';

// A zone's month of JAKIM times.
function zoneMonth(state, code, year, month) {
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

const HIJRI_MONTHS = ['Muharam', 'Safar', 'Rabiulawal', 'Rabiulakhir', 'Jamadilawal', 'Jamadilakhir',
  'Rejab', 'Syaaban', 'Ramadan', 'Syawal', 'Zulkaedah', 'Zulhijah'];

// The states MET names for a zone (the Federal Territories one by one).
function zoneStates(zone) {
  if (zone.code === 'WLY01') return ['W.P. Kuala Lumpur', 'W.P. Putrajaya'];
  if (zone.code === 'WLY02') return ['W.P. Labuan'];
  return [zone.negeri];
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
      const item = el('li', field === next ? 'next' : '');
      item.append(el('span', '', label), el('strong', '', today[field] ? formatClock(state, 'Asia/Kuala_Lumpur', today[field] * 1000) : '—'));
      if (field === next) item.append(el('span', 'visually-hidden', ' (seterusnya)'));
      list.append(item);
    }
    const tomorrow = entry.data.prayers.find((p) => p.day === today.day + 1);
    const ahead = upcoming(state, today, tomorrow, next, now);
    return ahead ? [ahead, list] : [list];
  });
}

// "Zohor dalam 1j 40m (13:10)"; after Isyak, tomorrow's Subuh if the month holds it.
function upcoming(state, today, tomorrow, next, now) {
  const [field, day] = next ? [next, today] : tomorrow?.fajr ? ['fajr', tomorrow] : [];
  if (!field) return null;
  const minutes = Math.ceil((day[field] * 1000 - now.getTime()) / 60000);
  const wait = [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)}j`, minutes % 60 && `${minutes % 60}m`].filter(Boolean).join(' ') || 'kurang seminit';
  const label = PRAYER_TIMES.find(([f]) => f === field)[1];
  const line = el('p', 'zone-next');
  line.append(el('strong', '', `${label}${next ? '' : ' esok'}`), ` dalam ${wait} (${formatClock(state, 'Asia/Kuala_Lumpur', day[field] * 1000)})`);
  return line;
}

// MET warnings in force for the zone's state, each linking to the full text.
function renderZoneAlerts(state, now) {
  const zone = zoneByCode(state.prayerZone);
  const { active } = activeWarnings(state, now);
  const mine = zone ? active.filter((w) => warningArea(w).states.some((s) => zoneStates(zone).includes(s))) : [];
  renderKeyed(alertsEl, mine.map((w) => `${w.warning_issue?.title_bm}|${w.valid_to}`).join('|'), () => mine.map((w) => {
    const alert = el('p', `zone-alert level-${warningArea(w).level}`);
    const more = el('a', '', 'Baca amaran');
    more.href = '#my-alerts-title';
    alert.append(icon('warning'), el('strong', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran MET'), more);
    return alert;
  }));
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
      row.append(date, el('td', '', hijri.day ? `${hijri.day} ${HIJRI_MONTHS[hijri.month - 1]}` : '—'));
      for (const [field] of columns) row.append(el('td', '', p[field] ? formatClock(state, 'Asia/Kuala_Lumpur', p[field] * 1000) : '—'));
    }
    return [head, body];
  });
}

// The month's five prayers as calendar events, each with a reminder at its time.
function monthCalendar(state) {
  const zone = zoneByCode(state.prayerZone);
  const { year, month } = shownMonth();
  const { entry } = zoneMonth(state, zone.code, year, month);
  const events = (entry.data.prayers ?? []).flatMap((p) => PRAYERS.filter((field) => p[field]).map((field) => {
    const label = PRAYER_TIMES.find(([f]) => f === field)[1];
    return {
      uid: `${zone.code}-${year}-${month}-${p.day}-${field}@jam-dunia`,
      start: p[field] * 1000,
      end: p[field] * 1000 + 10 * 60000,
      title: `${label} (${zone.code})`,
      description: `Waktu solat JAKIM bagi zon ${zone.code}: ${zone.daerah}, ${zone.negeri}. Dari Jam Dunia.`,
      alarm: true,
    };
  }));
  return icsCalendar(events, Date.now());
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
