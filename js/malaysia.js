// The Malaysia tab: warnings, earthquakes, weather, prayer times, Ramadan, facts.

import { icon } from './icons.js';
import { PRAYER_TIMES, WEATHER_API, hijriParts, nextPrayer, prayerFor, retryButton, weatherIcon } from './local-panel.js';
import { makeCity } from './storage.js';
import { MINUTE_MS, addDaysIso, cityDate, formatClock, parseMyt } from './time.js';
import { el, formatTempRange, normalizeName, renderKeyed } from './util.js';
import { JAKIM_ZONES, zoneByCode } from './jakim-zones.js';
import { distanceKm } from './qibla.js';
import { activeWarnings, levelSegments, levelTag, levelWord, namedLevel, seaWarningParts, warningArea, warningPlaces, warningSummary, worstNamedLevel } from './warnings.js';
import { renderZone, stateList, waitText, zoneStates } from './zones.js';
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

// "Nothing to report" as a small chip with a tick.
function allClear(text) {
  const chip = el('p', 'empty-chip');
  chip.append(icon('check'), text);
  return chip;
}

// ---------- "Semak kawasan anda": find a place in the weather warnings ----------

const searchKey = (text) => normalizeName(text).replace(/&/g, 'dan').replace(/\s+/g, ' ');
// The states a typed place lies in, from JAKIM's zone list of districts
// ("Kota Bharu" -> Kelantan), so a warning for a whole state still counts.
function statesFor(query) {
  const states = new Set();
  for (const zone of JAKIM_ZONES) {
    if (searchKey(`${zone.negeri}, ${zone.daerah}`).includes(query)) for (const s of zoneStates(zone)) states.add(s);
  }
  return states;
}

// Marks the places that match what was typed, folds the warnings that do not
// name it, and says so. A warning that names the place's state but not the
// place stays open: MET's district may not be the word the reader typed.
function applyAlertSearch() {
  const input = document.getElementById('alert-search');
  const statusEl = document.getElementById('alert-search-status');
  const typed = input.value.trim();
  const query = searchKey(typed);
  const on = query.length >= 2;
  const inStates = on ? statesFor(query) : new Set();
  let named = 0;
  let stateOnly = 0;
  for (const card of document.querySelectorAll('#my-warnings .alert')) {
    let hit = false;
    let near = false;
    for (const area of card.querySelectorAll('.alert-area')) {
      const stateHit = on && searchKey(area.dataset.state).includes(query);
      area.classList.toggle('is-match', stateHit);
      hit ||= stateHit;
      for (const chip of area.querySelectorAll('.place-chips li')) {
        // A whole-state chip names its state; it counts for any place in that state.
        const match = on && (chip.dataset.names.includes(query) || (chip.classList.contains('whole') && inStates.has(chip.dataset.state)));
        chip.classList.toggle('is-match', match);
        hit ||= match;
      }
      near ||= inStates.has(area.dataset.state);
    }
    if (on && !card.querySelector('.alert-area') && card.dataset.text.includes(query)) hit = true;
    card.classList.toggle('is-folded', on && !hit && !near);
    // A warning that names the place (or its state) opens wherever it was folded, so the match is seen.
    if (on && (hit || near)) {
      const places = card.querySelector('.alert-places');
      if (places) places.open = true;
      for (let fold = card.parentElement.closest('details'); fold; fold = fold.parentElement?.closest('details')) fold.open = true;
    }
    if (hit) named += 1;
    else if (on && near) stateOnly += 1;
  }
  let text = '';
  if (on && named) text = `"${typed}" disebut dalam ${named} amaran.`;
  else if (on && stateOnly) text = `"${typed}" tidak disebut, tetapi negerinya ada dalam ${stateOnly} amaran. Semak senarai daerah di bawah.`;
  else if (on) text = `Tiada amaran aktif yang menyebut "${typed}" atau negerinya.`;
  if (statusEl.textContent !== text) statusEl.textContent = text;
}
document.getElementById('alert-search').addEventListener('input', applyAlertSearch);

// "Tumpat, Kota Bharu, Machang dan 4 lagi".
function placeList(names, max = 4) {
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(', ')} dan ${names.at(-1)}` : names[0];
  return `${names.slice(0, max).join(', ')} dan ${names.length - max} lagi`;
}

// One sentence for a warning in the reader's state: what, where in that state, until when.
function mineSentence(w, myStates) {
  const title = w.warning_issue?.title_bm || w.heading_bm || 'Amaran';
  const parts = (warningPlaces(w.text_bm) ?? []).flatMap((s) => s.areas.filter((a) => myStates.includes(a.state)).map((a) => ({ ...a, period: s.period })));
  if (!parts.length) return `${title}.`; // named in MET's text, but not in a form the places can be read from
  const places = parts.flatMap((a) => a.places.map((p) => p.name));
  const period = parts.find((a) => a.period)?.period;
  return `${title}: ${places.length ? placeList(places) : 'seluruh negeri'}${period ? `, ${period}` : ''}.`;
}

// "3 amaran lain di 14 negeri dan perairan".
function othersSummary(others, haveZone) {
  const states = new Set(others.flatMap((w) => warningArea(w).states));
  const sea = others.some((w) => seaWarningParts(w.text_bm));
  const where = [states.size && `${states.size} negeri`, sea && 'perairan'].filter(Boolean).join(' dan ');
  return `${others.length} amaran ${haveZone ? 'lain' : 'aktif'}${where ? ` di ${where}` : ''}`;
}

// One warning as a card: level, title, then the places by state (or at sea), MET's own text
// folded under it. `foldPlaces` folds the place list too, for warnings outside the reader's state.
function warningCard(state, w, myStates, foldPlaces) {
  const item = el('article', 'alert');
  const text = w.text_bm || '';
  item.dataset.text = searchKey(text);
  const tag = levelTag(w);
  if (tag) item.append(tag);
  item.append(el('h4', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran'));
  const sections = warningPlaces(text);
  // Elsewhere, the place list folds behind one line; in the reader's state it shows.
  const host = foldPlaces ? el('details', 'alert-places') : item;
  if (sections) {
    // The places by state, so a reader finds theirs without reading the paragraph.
    const short = (name) => name.replace(/^W\.P\. /, '');
    for (const { period, areas } of sections) {
      if (period) host.append(el('p', 'alert-period', period));
      // States named with their districts, one block each.
      for (const { state: name, places } of areas.filter((a) => a.places.length)) {
        const area = el('div', 'alert-area');
        area.dataset.state = name;
        const title = el('h5', '', short(name));
        if (myStates.includes(name)) title.append(' ', el('span', 'your-state', 'negeri zon anda'));
        const chips = el('ul', 'place-chips');
        for (const p of places) {
          const chip = el('li', '', p.within.length ? `${p.name}: ${p.within.join(', ')}` : p.name);
          chip.dataset.names = searchKey([p.name, ...p.within].join('|'));
          chips.append(chip);
        }
        area.append(title, chips);
        host.append(area);
      }
      // States named without districts share one line: the whole state is covered.
      const whole = areas.filter((a) => !a.places.length);
      if (whole.length) {
        const area = el('div', 'alert-area');
        area.dataset.state = '';
        const chips = el('ul', 'place-chips');
        for (const { state: name } of whole) {
          const chip = el('li', 'whole', short(name));
          if (myStates.includes(name)) chip.append(el('span', 'your-state', ' · zon anda'));
          chip.dataset.state = name;
          chip.dataset.names = searchKey(name);
          chips.append(chip);
        }
        area.append(el('h5', '', 'Seluruh negeri'), chips);
        host.append(area);
      }
    }
  }
  const sea = sections ? null : seaWarningParts(text);
  if (sea) {
    // At sea: each kind of warning with when, the sea areas, and what it means for boats.
    for (const { heading, items } of sea) {
      host.append(el('h5', 'alert-section', heading));
      for (const { title, period, waters, impact } of items) {
        const area = el('div', 'alert-area');
        area.dataset.state = '';
        const chips = el('ul', 'place-chips');
        for (const water of waters) {
          const chip = el('li', '', water);
          chip.dataset.names = searchKey(water);
          chips.append(chip);
        }
        area.append(el('p', 'alert-item', title), el('p', 'alert-period', period), chips);
        if (impact) area.append(el('p', 'alert-impact', impact));
        host.append(area);
      }
    }
  }
  if (foldPlaces && (sections || sea)) {
    const count = host.querySelectorAll('.place-chips li').length;
    host.prepend(el('summary', '', sea ? `Lihat kawasan perairan (${count})` : `Lihat negeri dan daerah (${count})`));
    item.append(host);
  }
  if (sections || sea) {
    const full = el('details', 'alert-more');
    full.append(el('summary', '', 'Teks penuh MET'), el('p', '', text));
    item.append(full);
  } else {
    const summary = warningSummary(text);
    item.append(el('p', '', summary));
    if (summary !== text) {
      const more = el('details', 'alert-more');
      more.append(el('summary', '', 'Baca penuh'), el('p', '', text));
      item.append(more);
    }
  }
  const until = parseMyt(w.valid_to);
  if (Number.isFinite(until)) {
    item.append(el('p', 'local-status', `Sah hingga ${new Date(until).toLocaleString('ms-MY', {
      timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    })}`));
  }
  return item;
}

export function renderMalaysia(state, now) {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  document.getElementById('my-today').textContent = `${now.toLocaleDateString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })}, ${formatClock(state, 'Asia/Kuala_Lumpur', now.getTime())} waktu Malaysia (UTC+8)`;

  // Warnings still in force.
  const { key: warnKey, entry: warnings, active } = activeWarnings(state, now);
  // Keyed on what is shown, not the minute, so an opened "Baca penuh" stays open.
  const warnRenderKey = [warnings.status, state.hour24, state.prayerZone, ...active.map((w) => `${w.warning_issue?.issued}|${w.valid_to}|${w.text_bm}`)].join('|');
  const myStates = zoneByCode(state.prayerZone) ? zoneStates(zoneByCode(state.prayerZone)) : [];
  const warningsEl = document.getElementById('my-warnings');
  renderKeyed(warningsEl, warnRenderKey, () => {
    const heading = el('h3', '', 'Amaran cuaca');
    if (warnings.status !== 'ok') return [heading, statusLine(state, warnings, warnKey, 'Amaran cuaca')];
    const isMine = (w) => warningArea(w).states.some((s) => myStates.includes(s));
    const mine = active.filter(isMine);
    const others = active.filter((w) => !isMine(w));
    const out = [heading];
    // The reader's own state first, one sentence a warning; the full card one click away.
    if (myStates.length) {
      const box = el('div', 'alert-mine');
      box.append(el('h4', '', `Untuk ${stateList(myStates)}`));
      if (!mine.length) box.append(el('p', 'alert-mine-none', `Tiada amaran untuk ${stateList(myStates)}.`));
      for (const w of mine) {
        const line = el('div', 'alert-mine-item');
        const tag = levelTag(w);
        if (tag) line.append(tag);
        line.append(el('p', '', mineSentence(w, myStates)));
        const more = el('details', 'alert-card-more');
        more.append(el('summary', '', 'Butiran amaran'), warningCard(state, w, myStates, false));
        line.append(more);
        box.append(line);
      }
      out.push(box);
    }
    if (!active.length) return [...out, allClear('Tiada amaran cuaca aktif')];
    if (!others.length) return out;
    // Everywhere else is reference: counted, and folded until asked for.
    const rest = el('details', 'alert-others');
    rest.open = !myStates.length; // no zone chosen yet: nothing to put first, so show them
    rest.append(el('summary', '', othersSummary(others, myStates.length > 0)), ...others.map((w) => warningCard(state, w, myStates, true)));
    out.push(rest);
    return out;
  });
  applyAlertSearch();

  // The latest earthquakes MET reports.
  const quakeKey = 'gempa';
  const quakes = state.localData.get(quakeKey, `${QUAKE_API}?sort=-utcdatetime&limit=5`);
  const from = myStates.length ? MALAYSIA_STATES.find((s) => s.state === myStates[0]) : MALAYSIA_STATES.find((s) => s.state === 'W.P. Kuala Lumpur');
  renderKeyed(document.getElementById('my-quakes'), `${quakes.status}|${state.hour24}|${from?.capital}`, () => {
    if (quakes.status !== 'ok') return [statusLine(state, quakes, quakeKey, 'Data gempa bumi')];
    const list = (Array.isArray(quakes.data) ? quakes.data : []).filter((q) => q.visible !== false);
    if (!list.length) return [allClear('Tiada laporan gempa bumi')];
    // Folded: the count, and the nearest one when MET gives coordinates (never read from its text).
    const placed = from ? list.filter((q) => Number.isFinite(Number(q.lat)) && Number.isFinite(Number(q.lon)) && q.lat !== null && q.lon !== null) : [];
    const km = (q) => distanceKm({ lat: from.lat, lon: from.lon }, { lat: Number(q.lat), lon: Number(q.lon) });
    const nearest = placed.length ? placed.reduce((a, b) => (km(b) < km(a) ? b : a)) : null;
    const fold = el('details', 'quake-fold');
    const summary = el('summary', '');
    summary.append(el('strong', '', 'Gempa bumi terkini:'), ` ${list.length} laporan`);
    if (nearest) {
      summary.append(el('span', 'quake-nearest', ` · terdekat: magnitud ${nearest.magdefault ?? '?'}, ${nearest.location || nearest.location_original || ''}, ${Math.round(km(nearest)).toLocaleString('ms-MY')} km dari ${from.capital}`));
    }
    fold.append(summary, ...list.map((q) => {
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
    }));
    return [fold];
  });
  // Every state's forecast for today, as exact figures in the folded tables.
  const forecasts = stateForecasts(state, now);
  renderKeyed(document.getElementById('my-weather'), `${forecasts.key}|${forecasts.entry.status}|${state.tempUnit}`, () => {
    if (forecasts.entry.status !== 'ok') {
      const row = el('tbody').insertRow();
      row.insertCell().append(statusLine(state, forecasts.entry, forecasts.key, 'Ramalan cuaca'));
      return [row.parentElement];
    }
    const rows = (Array.isArray(forecasts.entry.data) ? forecasts.entry.data : [])
      .filter((r) => r.date === forecasts.iso)
      .sort((a, b) => (a.location?.location_name ?? '').localeCompare(b.location?.location_name ?? ''));
    const head = el('thead');
    const headRow = head.insertRow();
    for (const label of ['Negeri', 'Ramalan', 'Suhu']) headRow.append(el('th', '', label));
    const body = el('tbody');
    if (!rows.length) body.insertRow().insertCell().textContent = 'Tiada ramalan negeri untuk hari ini.';
    for (const r of rows) {
      const row = body.insertRow();
      const name = el('th', '', r.location?.location_name ?? '');
      name.scope = 'row';
      row.append(name, el('td', '', r.summary_forecast || r.afternoon_forecast || 'tiada'), el('td', '', formatTempRange(state, r.min_temp, r.max_temp)));
    }
    return [head, body];
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
        cell.textContent = p.today[field] ? formatClock(state, p.s.zone, p.today[field] * 1000) : 'tiada';
        if (field === next) cell.className = 'next';
      }
    }
    return [head, body];
  });

  renderStates(state, now, { forecasts, active, warnings, myStates, prayers });
  renderRamadan(state, prayers, now);
  renderZone(state, now);
  // The Takwim Islam section's code is fetched the first time this tab is drawn.
  const takwimKey = 'modul-takwim';
  const takwim = state.localData.get(takwimKey, () => import('./takwim.js'));
  if (takwim.status === 'ok') takwim.data.renderTakwim(state, now);
  else renderKeyed(document.getElementById('takwim'), takwim.status, () => (takwim.status === 'error'
    ? [el('p', 'local-status', 'Takwim gagal dimuat. '), retryButton(state, takwimKey)]
    : [el('p', 'local-status', 'Memuatkan takwim…')]));
}

// ---------- "Negeri hari ini": the tile map and the chosen state's details ----------

// Each state's tile on a 6-column grid, roughly where it lies (DESIGN.md,
// "Peta jubin negeri"): the peninsula in columns 1 to 3, the sea in 4, Borneo in 5 and 6.
const STATE_TILES = {
  Perlis: ['PLS', 1, 1], Kedah: ['KDH', 2, 1], Kelantan: ['KTN', 3, 1],
  'Pulau Pinang': ['PNG', 1, 2], Perak: ['PRK', 2, 2], Terengganu: ['TRG', 3, 2],
  Selangor: ['SGR', 1, 3], 'W.P. Kuala Lumpur': ['KUL', 2, 3], Pahang: ['PHG', 3, 3, 2],
  'W.P. Putrajaya': ['PJY', 1, 4], 'Negeri Sembilan': ['NSN', 2, 4],
  Melaka: ['MLK', 2, 5], Johor: ['JHR', 3, 5],
  'W.P. Labuan': ['LBN', 5, 1], Sabah: ['SBH', 6, 1], Sarawak: ['SWK', 5, 2],
};

// The warnings in force that name state `name` (land warnings only).
const warningsFor = (active, name) => active.filter((w) => warningArea(w).states.includes(name));

// "Hari ini", "Esok", then the weekday, for a forecast's date.
function dayLabel(iso, todayIso) {
  if (iso === todayIso) return 'Hari ini';
  if (iso === addDaysIso(todayIso, 1)) return 'Esok';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('ms-MY', { weekday: 'long', timeZone: 'UTC' });
}

function renderStates(state, now, { forecasts, active, warnings, myStates, prayers }) {
  const chosen = state.stateView ?? myStates[0] ?? 'W.P. Kuala Lumpur';
  const rows = forecasts.entry.status === 'ok' && Array.isArray(forecasts.entry.data) ? forecasts.entry.data : [];
  const tilesEl = document.getElementById('my-tiles');
  const tileKey = [forecasts.key, forecasts.entry.status, warnings.status, myStates.join(), ...active.map((w) => `${w.warning_issue?.issued}|${w.valid_to}`)].join('|');
  // Rebuilt only when the data changes: choosing a tile keeps its focus.
  renderKeyed(tilesEl, tileKey, () => MALAYSIA_STATES.map((s) => {
    const [code, col, row, span = 1] = STATE_TILES[s.state];
    const today = forecastForState(rows, s.state, forecasts.iso);
    const summary = today ? today.summary_forecast || today.afternoon_forecast || '' : '';
    const ws = warningsFor(active, s.state);
    const level = worstNamedLevel(ws);
    const tile = el('button', `state-tile${myStates.includes(s.state) ? ' is-mine' : ''}`);
    tile.type = 'button';
    tile.dataset.state = s.state;
    tile.style.gridArea = `${row} / ${col} / span ${span} / span 1`;
    tile.setAttribute('aria-controls', 'my-state');
    // Its name and what the marks say, read out in full.
    const said = [s.state.replace(/^W\.P\. /, ''), summary || (forecasts.entry.status === 'ok' ? 'tiada ramalan' : ''),
      ws.length ? (level ? `amaran ${levelWord(level)}` : 'ada amaran') : 'tiada amaran', myStates.includes(s.state) ? 'negeri zon anda' : ''];
    tile.setAttribute('aria-label', said.filter(Boolean).join(', '));
    tile.title = said.filter(Boolean).join(' · ');
    const mark = el('span', 'tile-weather');
    if (today) mark.append(weatherIcon(summary));
    const codeEl = el('span', 'tile-code', code);
    codeEl.translate = false; // an identifier, not words to translate
    tile.append(codeEl, mark);
    if (level) tile.append(levelSegments(level));
    else if (ws.length) tile.append(icon('warning', 'tile-alert'));
    if (myStates.includes(s.state)) tile.append(icon('pin', 'tile-mine'));
    tile.addEventListener('click', () => {
      state.stateView = s.state;
      state.refresh();
    });
    return tile;
  }));
  for (const tile of tilesEl.children) tile.setAttribute('aria-pressed', String(tile.dataset.state === chosen));

  const s = MALAYSIA_STATES.find((x) => x.state === chosen);
  const p = prayers.find((x) => x.s.state === chosen);
  const ws = warningsFor(active, chosen);
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  const days = [0, 1, 2].map((i) => addDaysIso(forecasts.iso, i));
  renderKeyed(document.getElementById('my-state'), [chosen, tileKey, p.key, p.entry.status, minute, state.hour24, state.tempUnit].join('|'), () => {
    const head = el('h3', '', s.state.replace(/^W\.P\. /, ''));
    head.append(' ', el('small', '', s.capital));
    const out = [head];

    // The next prayer in the capital.
    const next = nextPrayer(p.today, now);
    const prayerLine = el('p', 'state-next');
    if (p.entry.status === 'error') prayerLine.append(el('span', 'local-status', 'Waktu solat gagal dimuat. '), retryButton(state, p.key));
    else if (!p.today) prayerLine.append(el('span', 'local-status', p.entry.status === 'loading' ? 'Memuatkan waktu solat…' : 'Tiada waktu solat untuk tarikh ini.'));
    else if (!next) prayerLine.append(el('span', 'local-status', `Isyak sudah masuk di ${s.capital}; Subuh esok.`));
    else {
      const label = PRAYER_TIMES.find(([f]) => f === next)[1];
      prayerLine.append(el('strong', '', label), ` dalam ${waitText(p.today[next] * 1000, now)} `,
        el('span', 'zone-at', `(${formatClock(state, s.zone, p.today[next] * 1000)}, ${s.capital})`));
    }
    out.push(prayerLine);

    // Today and the next two days.
    if (forecasts.entry.status !== 'ok') out.push(statusLine(state, forecasts.entry, forecasts.key, 'Ramalan cuaca'));
    else {
      const list = el('ul', 'state-days');
      for (const iso of days) {
        const r = forecastForState(rows, chosen, iso);
        const item = el('li');
        const symbol = el('span', 'weather-icon');
        const summary = r ? r.summary_forecast || r.afternoon_forecast || '' : '';
        if (r) symbol.append(weatherIcon(summary));
        item.append(symbol, el('strong', '', dayLabel(iso, forecasts.iso)), el('span', '', r ? summary : 'tiada ramalan'),
          el('span', 'weather-temp', r ? formatTempRange(state, r.min_temp, r.max_temp) : ''));
        list.append(item);
      }
      out.push(list);
    }

    // Its warnings, each with the level in segments and words.
    const alerts = el('div', 'state-alerts');
    if (warnings.status !== 'ok') alerts.append(el('p', 'local-status', 'Amaran belum dimuat.'));
    else if (!ws.length) alerts.append(el('p', 'local-status', `Tiada amaran untuk ${stateList([chosen])}.`));
    for (const w of ws) {
      const row = el('p', 'state-alert');
      row.append(levelSegments(namedLevel(w)), el('span', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran MET'));
      const tag = levelTag(w);
      if (tag) row.append(tag);
      alerts.append(row);
    }
    if (ws.length) {
      // Finds the state in the warning list below, with its districts marked.
      const find = el('button', 'secondary state-find', 'Lihat daerah dalam senarai amaran');
      find.type = 'button';
      find.addEventListener('click', () => {
        const input = document.getElementById('alert-search');
        input.value = stateList([chosen]);
        applyAlertSearch();
        document.getElementById('my-alerts-title').scrollIntoView({ block: 'start' });
        input.focus({ preventScroll: true });
      });
      alerts.append(find);
    }
    out.push(alerts);
    return out;
  });
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
    const day = el('p', 'ramadan-day');
    day.append(icon('moon'), ` Ramadan hari ke-${hijri.day}, ${hijri.year}H`);
    head.append(day);
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
        row.insertCell().textContent = p.today?.[field] ? formatClock(state, p.s.zone, p.today[field] * 1000) : 'tiada';
      }
    }
    const scroll = el('div', 'table-scroll');
    // Focusable so it scrolls from the keyboard (Safari does not focus scrollers by itself).
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Jadual imsak dan berbuka');
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
