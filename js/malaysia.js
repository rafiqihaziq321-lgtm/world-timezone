// The Malaysia tab: warnings, earthquakes, weather, prayer times, Ramadan, facts.

import { PRAYER_TIMES, WEATHER_API, hijriParts, nextPrayer, prayerFor, retryButton, weatherIcon } from './local-panel.js';
import { makeCity } from './storage.js';
import { MINUTE_MS, addDaysIso, cityDate, formatClock, parseMyt } from './time.js';
import { el, normalizeName, renderKeyed } from './util.js';
import { activeWarnings, warningSummary } from './warnings.js';
import { renderZone } from './zones.js';
import { MALAYSIA_STATES, MALAYSIA_TOTAL } from '../malaysia-data.js';

export const QUAKE_API = 'https://api.data.gov.my/weather/warning/earthquake';
export function loadErrorText(entry, what) {
  return /\b429\b/.test(entry.error?.message ?? '')
    ? `Had permintaan data.gov.my dicapai (4 seminit). Cuba lagi sebentar lagi.`
    : `${what} tidak dapat dimuat.`;
}

// One request for every state's forecast, today and the next two days; the
// Malaysia and Bandar tabs both read it (the API allows 4 requests a minute).
export function stateForecasts(state, now) {
  const { iso } = cityDate('Asia/Kuala_Lumpur', now);
  const url = `${WEATHER_API}?contains=St@location__location_id&date_start=${iso}@date&date_end=${addDaysIso(iso, 2)}@date&limit=100`;
  return { iso, key: `cuaca-negeri|${iso}`, entry: state.localData.get(`cuaca-negeri|${iso}`, url) };
}

// Today's forecast for every MET location, in one request (towns cannot be
// asked for by name in a single query), matched to MALAYSIA_TOWNS by name.
export function townForecasts(state, now) {
  const { iso } = cityDate('Asia/Kuala_Lumpur', now);
  const key = `cuaca-bandar|${iso}`;
  const url = `${WEATHER_API}?date_start=${iso}@date&date_end=${iso}@date&include=location,date,summary_forecast,afternoon_forecast,min_temp,max_temp&limit=1000`;
  return { iso, key, entry: state.localData.get(key, url) };
}

export function forecastForTown(rows, town, iso) {
  for (const name of town.metNames ?? [town.name]) {
    const row = rows.find((r) => r.date === iso && normalizeName(r.location?.location_name ?? '') === normalizeName(name));
    if (row) return row;
  }
  return null;
}

// MET names its state locations its own way ("WP Kuala Lumpur", "Penang"...).
export function stateNameKey(name) {
  const aliases = { penang: 'pulau pinang', malacca: 'melaka' };
  const key = normalizeName(name).replace(/^(w\.?\s?p\.?|wilayah persekutuan)\s+/, '').trim();
  return aliases[key] ?? key;
}

export function forecastForState(rows, stateName, iso) {
  const want = stateNameKey(stateName);
  return rows.find((r) => r.date === iso && stateNameKey(r.location?.location_name ?? '') === want) ?? null;
}

export function statusLine(state, entry, key, what) {
  if (entry.status === 'loading') return el('p', 'local-status', `Memuatkan ${what.toLowerCase()}…`);
  const box = el('div', 'load-error');
  box.append(el('p', 'local-status', loadErrorText(entry, what)), retryButton(state, key));
  return box;
}

export function renderMalaysia(state, now) {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  document.getElementById('my-today').textContent = `${now.toLocaleDateString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })}, ${formatClock(state, 'Asia/Kuala_Lumpur', now.getTime())} waktu Malaysia (UTC+8)`;

  // Warnings still in force.
  const { key: warnKey, entry: warnings, active } = activeWarnings(state, now);
  // Keyed on what is shown, not the minute, so an opened "Baca penuh" stays open.
  const warnRenderKey = [warnings.status, state.hour24, ...active.map((w) => `${w.warning_issue?.issued}|${w.valid_to}|${w.text_bm}`)].join('|');
  renderKeyed(document.getElementById('my-warnings'), warnRenderKey, () => {
    const heading = el('h3', '', 'Amaran cuaca');
    if (warnings.status !== 'ok') return [heading, statusLine(state, warnings, warnKey, 'Amaran cuaca')];
    if (!active.length) return [heading, el('p', 'local-status', 'Tiada amaran cuaca aktif.')];
    return [heading, ...active.map((w) => {
      const item = el('article', 'alert');
      const text = w.text_bm || '';
      const summary = warningSummary(text);
      item.append(el('h4', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran'), el('p', '', summary));
      if (summary !== text) {
        const more = el('details', 'alert-more');
        more.append(el('summary', '', 'Baca penuh'), el('p', '', text));
        item.append(more);
      }
      const until = parseMyt(w.valid_to);
      if (Number.isFinite(until)) {
        item.append(el('p', 'local-status', `Sah hingga ${new Date(until).toLocaleString('ms-MY', {
          timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          hourCycle: state.hour24 ? 'h23' : 'h12',
        })}`));
      }
      return item;
    })];
  });

  // The latest earthquakes MET reports.
  const quakeKey = 'gempa';
  const quakes = state.localData.get(quakeKey, `${QUAKE_API}?sort=-utcdatetime&limit=5`);
  renderKeyed(document.getElementById('my-quakes'), `${quakes.status}|${state.hour24}`, () => {
    const heading = el('h3', '', 'Gempa bumi terkini');
    if (quakes.status !== 'ok') return [heading, statusLine(state, quakes, quakeKey, 'Data gempa bumi')];
    const list = (Array.isArray(quakes.data) ? quakes.data : []).filter((q) => q.visible !== false).slice(0, 3);
    if (!list.length) return [heading, el('p', 'local-status', 'Tiada laporan gempa bumi.')];
    return [heading, ...list.map((q) => {
      const item = el('article', 'alert quake');
      const when = parseMyt(q.localdatetime);
      item.append(
        el('h4', '', `Magnitud ${q.magdefault ?? '?'}: ${q.location || q.location_original || ''}`),
        el('p', '', q.nbm_distancemas || ''),
      );
      if (Number.isFinite(when)) {
        item.append(el('p', 'local-status', new Date(when).toLocaleString('ms-MY', {
          timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          hourCycle: state.hour24 ? 'h23' : 'h12',
        })));
      }
      return item;
    })];
  });

  // Every state's forecast for today.
  const forecasts = stateForecasts(state, now);
  renderKeyed(document.getElementById('my-weather'), `${forecasts.key}|${forecasts.entry.status}`, () => {
    if (forecasts.entry.status !== 'ok') return [statusLine(state, forecasts.entry, forecasts.key, 'Ramalan cuaca')];
    const rows = (Array.isArray(forecasts.entry.data) ? forecasts.entry.data : [])
      .filter((r) => r.date === forecasts.iso)
      .sort((a, b) => (a.location?.location_name ?? '').localeCompare(b.location?.location_name ?? ''));
    if (!rows.length) return [el('p', 'local-status', 'Tiada ramalan negeri untuk hari ini.')];
    return rows.map((r) => {
      const tile = el('article', 'weather-tile');
      const summary = r.summary_forecast || r.afternoon_forecast || '';
      tile.append(
        el('span', 'weather-icon', weatherIcon(summary)),
        el('h3', '', r.location?.location_name ?? ''),
        el('p', '', summary),
        el('p', 'weather-temp', `${r.min_temp}–${r.max_temp}°C`),
      );
      return tile;
    });
  });

  // JAKIM times for each capital.
  const prayers = MALAYSIA_STATES.map((s) => ({ s, ...prayerFor(state, makeCity(s.capital, s.zone, s.lat, s.lon), now) }));
  const prayerKey = prayers.map((p) => `${p.key}:${p.entry.status}`).join('|');
  renderKeyed(document.getElementById('my-prayers'), `${prayerKey}|${minute}|${state.hour24}`, () => {
    const head = el('thead');
    const headRow = head.insertRow();
    for (const label of ['Negeri', ...PRAYER_TIMES.map(([, l]) => l)]) headRow.append(el('th', '', label));
    const body = el('tbody');
    for (const p of prayers) {
      const row = body.insertRow();
      const name = el('th', '', p.s.state);
      name.scope = 'row';
      name.append(el('small', '', p.s.capital));
      row.append(name);
      if (p.entry.status !== 'ok' || !p.today) {
        const cell = row.insertCell();
        cell.colSpan = PRAYER_TIMES.length;
        if (p.entry.status === 'error') cell.append(el('span', 'local-status', 'Gagal dimuat. '), retryButton(state, p.key));
        else cell.append(el('span', 'local-status', p.entry.status === 'loading' ? 'Memuatkan…' : 'Tiada data untuk tarikh ini.'));
        continue;
      }
      const next = nextPrayer(p.today, now);
      for (const [field] of PRAYER_TIMES) {
        const cell = row.insertCell();
        cell.textContent = p.today[field] ? formatClock(state, p.s.zone, p.today[field] * 1000) : '—';
        if (field === next) cell.className = 'next';
      }
    }
    return [head, body];
  });

  renderRamadan(state, prayers, now);
  renderZone(state, now);
}

// Shown only while it is Ramadan by JAKIM's calendar (the same nationwide),
// counting down to the next imsak or berbuka in the chosen state's capital.
export function renderRamadan(state, prayers, now) {
  const section = document.getElementById('ramadan');
  const kl = prayers.find((p) => p.s.state === 'W.P. Kuala Lumpur');
  const hijri = hijriParts(kl?.today);
  section.hidden = hijri.month !== 9;
  if (section.hidden) return;

  const chosen = prayers.find((p) => p.s.state === state.ramadanState) ?? kl;
  const nowS = now.getTime() / 1000;
  const tomorrow = chosen.entry.status === 'ok' && Array.isArray(chosen.entry.data.prayers)
    ? chosen.entry.data.prayers.find((p) => p.day === chosen.day + 1) : null;
  const next = !chosen.today ? null
    : nowS < chosen.today.imsak ? { label: 'Imsak', at: chosen.today.imsak }
      : nowS < chosen.today.maghrib ? { label: 'Berbuka', at: chosen.today.maghrib }
        : tomorrow?.imsak && hijriParts(tomorrow).month === 9 ? { label: 'Imsak esok', at: tomorrow.imsak } : null;
  const box = document.getElementById('my-ramadan');
  const statuses = prayers.map((p) => p.entry.status).join('');
  renderKeyed(box, [hijri.day, chosen.s.state, next?.label, statuses, state.hour24].join('|'), () => {
    const head = el('div', 'ramadan-head');
    head.append(el('p', 'ramadan-day', `🌙 Ramadan hari ke-${hijri.day}, ${hijri.year}H`));
    const pick = el('label', 'ramadan-pick', 'Negeri ');
    const select = el('select');
    for (const p of prayers) select.append(new Option(`${p.s.state} (${p.s.capital})`, p.s.state));
    select.value = chosen.s.state;
    select.addEventListener('change', () => {
      state.ramadanState = select.value;
      state.refresh();
    });
    pick.append(select);
    head.append(pick);

    const count = el('div', 'ramadan-count');
    if (next) {
      count.append(
        el('p', 'ramadan-label', `${next.label} di ${chosen.s.capital} dalam`),
        el('p', 'ramadan-timer'),
        el('p', 'local-status', `pada ${formatClock(state, chosen.s.zone, next.at * 1000)}`),
      );
    } else {
      count.append(el('p', 'ramadan-label', chosen.today ? 'Selamat berbuka puasa.' : 'Waktu imsak dan berbuka belum dimuat.'));
    }

    const table = el('table', 'data-table');
    const headRow = table.createTHead().insertRow();
    for (const label of ['Negeri', 'Imsak', 'Berbuka']) headRow.append(el('th', '', label));
    const body = table.createTBody();
    for (const p of prayers) {
      const row = body.insertRow();
      const name = el('th', '', p.s.state);
      name.scope = 'row';
      row.append(name);
      for (const field of ['imsak', 'maghrib']) {
        row.insertCell().textContent = p.today?.[field] ? formatClock(state, p.s.zone, p.today[field] * 1000) : '—';
      }
    }
    const scroll = el('div', 'table-scroll');
    scroll.append(table);
    return [head, count, scroll];
  });
  // The timer ticks without rebuilding the section (the select keeps focus).
  const timer = box.querySelector('.ramadan-timer');
  if (timer && next) {
    const left = Math.max(0, Math.round(next.at - nowS));
    timer.textContent = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((n) => String(n).padStart(2, '0')).join(':');
  }
}

export function renderFacts() {
  const table = document.getElementById('my-facts');
  const head = el('thead');
  const headRow = head.insertRow();
  for (const label of ['Negeri', 'Ibu negeri', 'Penduduk (juta)', 'Keluasan (km²)']) headRow.append(el('th', '', label));
  const body = el('tbody');
  const largest = Math.max(...MALAYSIA_STATES.map((s) => s.population));
  for (const s of [...MALAYSIA_STATES].sort((a, b) => b.population - a.population)) {
    const row = body.insertRow();
    const name = el('th', '', s.state);
    name.scope = 'row';
    row.append(name, el('td', '', s.capital));
    const pop = row.insertCell();
    const bar = el('span', 'bar');
    bar.style.setProperty('--share', String(s.population / largest));
    pop.append(bar, el('span', '', s.population.toLocaleString('ms-MY', { minimumFractionDigits: 1 })));
    row.append(el('td', '', `≈ ${s.area.toLocaleString('ms-MY')}`));
  }
  const foot = el('tfoot');
  const total = foot.insertRow();
  const label = el('th', '', 'Malaysia');
  label.scope = 'row';
  total.append(label, el('td', '', ''), el('td', '', MALAYSIA_TOTAL.population.toLocaleString('ms-MY', { minimumFractionDigits: 1 })),
    el('td', '', `≈ ${MALAYSIA_TOTAL.area.toLocaleString('ms-MY')}`));
  table.replaceChildren(head, body, foot);
}
