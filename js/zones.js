// The viewer's own JAKIM prayer zone in the Malaysia tab: chosen from the
// list or found from their location, saved, and followed by the reminders.

import { JAKIM_ZONES, zoneByCode } from './jakim-zones.js';
import { PRAYER_TIMES, nextPrayer, retryButton } from './local-panel.js';
import { locate, locationErrorText } from './qibla.js';
import { saveState } from './storage.js';
import { cityDate, formatClock } from './time.js';
import { el, fetchJson, renderKeyed } from './util.js';

export const ZONE_API = 'https://api.waktusolat.app';

// A zone's month of JAKIM times; every zone keeps Malaysian time.
export function zonePrayerFor(state, code, now) {
  const { year, month, day } = cityDate('Asia/Kuala_Lumpur', now);
  const key = `solat-zon|${code}|${year}-${month}`;
  const entry = state.localData.get(key, `${ZONE_API}/v2/solat/${code}?year=${year}&month=${month}`);
  const today = entry.status === 'ok' && Array.isArray(entry.data?.prayers)
    ? entry.data.prayers.find((p) => p.day === day) ?? null
    : null;
  return { key, entry, today };
}

const selectEl = document.getElementById('zone-select');
const locateEl = document.getElementById('zone-locate');
const statusEl = document.getElementById('zone-status');
const timesEl = document.getElementById('zone-times');

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
