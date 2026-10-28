// The prayer, weather, air and qibla panel for a Malaysian city.

import { AIR_BANDS } from './air.js';
import { icon } from './icons.js';
import { qiblaSection } from './qibla.js';
import { MINUTE_MS, addDaysIso, cityDate, formatClock } from './time.js';
import { el, formatTempRange, normalizeName } from './util.js';

export const MALAYSIA_ZONES = ['Asia/Kuala_Lumpur', 'Asia/Kuching'];
export const PRAYER_API = 'https://api.waktusolat.app/v2/solat/gps'; // JAKIM times; zone found from GPS
export const WEATHER_API = 'https://api.data.gov.my/weather/forecast'; // MET Malaysia 7-day forecast
export const AIR_QUALITY_URL = 'https://eqms.doe.gov.my/'; // JAS APIMS: no public API, so we link to it
export const PRAYER_TIMES = [['fajr', 'Subuh'], ['syuruk', 'Syuruk'], ['dhuhr', 'Zohor'], ['asr', 'Asar'], ['maghrib', 'Maghrib'], ['isha', 'Isyak']];
export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']; // syuruk is sunrise, not a prayer

export function isMalaysian(city) {
  return MALAYSIA_ZONES.includes(city.zone);
}

export function retryButton(state, key) {
  const button = el('button', 'local-retry', 'Cuba lagi');
  button.type = 'button';
  button.addEventListener('click', () => state.localData.retry(key));
  return button;
}

export function prayerSection(state, city, entry, key, now, day) {
  const section = el('section', 'local-block');
  const heading = el('h3', '', 'Waktu solat');
  section.append(heading);
  if (!entry) {
    section.append(el('p', '', 'Kedudukan bandar ini tidak diketahui, jadi zon waktu solatnya tidak dapat ditentukan.'));
    return section;
  }
  if (entry.status === 'loading') {
    section.append(el('p', 'local-status', 'Memuatkan waktu solat…'));
    return section;
  }
  if (entry.status === 'error') {
    section.append(el('p', 'local-status', 'Waktu solat tidak dapat dimuat.'), retryButton(state, key));
    return section;
  }
  const today = Array.isArray(entry.data.prayers) ? entry.data.prayers.find((p) => p.day === day) : undefined;
  if (!today) {
    section.append(el('p', 'local-status', 'Tiada waktu solat untuk tarikh ini.'));
    return section;
  }
  heading.append(' ', el('small', '', `zon ${entry.data.zone}`));
  const nowSec = now.getTime() / 1000;
  const next = PRAYERS.find((field) => today[field] && today[field] > nowSec);
  const fmt = (ts) => new Date(ts * 1000).toLocaleTimeString('ms-MY', {
    timeZone: city.zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
  const list = el('ul', 'prayer-times');
  for (const [field, label] of PRAYER_TIMES) {
    const item = el('li', field === next ? 'next' : '');
    item.append(el('span', '', label), el('strong', '', today[field] ? fmt(today[field]) : '—'));
    list.append(item);
  }
  section.append(list);
  if (hijriParts(today).month === 9 && today.imsak && today.maghrib) {
    const line = el('p', 'ramadan-line');
    line.append(icon('moon'), ` Ramadan: imsak ${fmt(today.imsak)} · berbuka ${fmt(today.maghrib)}`);
    section.append(line);
  }
  if (next) {
    const label = PRAYER_TIMES.find(([field]) => field === next)[1];
    const minutes = Math.ceil((today[next] - nowSec) / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const wait = [h && `${h}j`, m && `${m}m`].filter(Boolean).join(' ');
    section.append(el('p', 'next-prayer', `Seterusnya: ${label} dalam ${wait}`));
  } else {
    section.append(el('p', 'next-prayer', 'Semua waktu solat hari ini telah berlalu.'));
  }
  return section;
}

export function weatherSection(state, city, entry, key, iso) {
  const section = el('section', 'local-block');
  const heading = el('h3', '', 'Cuaca');
  section.append(heading);
  if (entry.status === 'loading') {
    section.append(el('p', 'local-status', 'Memuatkan ramalan cuaca…'));
    return section;
  }
  if (entry.status === 'error') {
    section.append(el('p', 'local-status', 'Ramalan cuaca tidak dapat dimuat.'), retryButton(state, key));
    return section;
  }
  const records = Array.isArray(entry.data) ? entry.data : [];
  // The search matches substrings, so prefer the location named exactly like the city.
  const exact = records.filter((r) => normalizeName(r.location?.location_name ?? '') === normalizeName(city.name));
  const record = (exact.length ? exact : records).find((r) => r.date === iso);
  if (!records.length) {
    section.append(el('p', 'local-status', `Tiada ramalan MET Malaysia untuk ${city.name}.`));
    return section;
  }
  if (!record) {
    section.append(el('p', 'local-status', 'Tiada ramalan untuk tarikh ini.'));
    return section;
  }
  heading.append(' ', el('small', '', formatTempRange(state, record.min_temp, record.max_temp)));
  const list = el('dl', 'forecast');
  for (const [label, text] of [['Pagi', record.morning_forecast], ['Petang', record.afternoon_forecast], ['Malam', record.night_forecast]]) {
    list.append(el('dt', '', label), el('dd', '', text ?? '—'));
  }
  section.append(list);
  // The next two days, one line each.
  const ahead = [['Esok', 1], ['Lusa', 2]]
    .map(([label, days]) => [label, (exact.length ? exact : records).find((r) => r.date === addDaysIso(iso, days))])
    .filter(([, r]) => r);
  if (ahead.length) {
    const days = el('ul', 'forecast-days');
    for (const [label, r] of ahead) {
      const summary = r.summary_forecast || r.afternoon_forecast || '';
      const item = el('li');
      const symbol = el('span', 'forecast-icon');
      symbol.append(weatherIcon(summary));
      item.append(el('strong', '', label), symbol, el('span', '', summary), el('span', 'forecast-temp', formatTempRange(state, r.min_temp, r.max_temp)));
      days.append(item);
    }
    section.append(days);
  }
  if (!exact.length) section.append(el('p', 'local-status', `Ramalan untuk ${record.location?.location_name}.`));
  return section;
}

// `air` is a state capital's estimate from stateAirQuality(), or null where
// we have none (cities outside the Bandar tab), which leaves only the link.
// Columns for the last 24 hours, coloured by IPU band; height carries the
// value and faint lines mark the band edges, so colour is never the only cue.
// Hovering a column reads it out; a hidden table gives screen readers every hour.
export function aqiChart(state, hours, zone) {
  const box = el('figure', 'aqi-chart');
  const top = Math.max(100, Math.ceil(Math.max(...hours.map((h) => h.index ?? 0)) / 50) * 50);
  const [left, right, plotTop, base] = [28, 318, 8, 88];
  const y = (v) => base - (v / top) * (base - plotTop);
  const slot = (right - left) / 24;
  const width = Math.min(slot - 2, 12);
  const clock = (t) => formatClock(state, zone, t * 1000);
  const band = (index) => AIR_BANDS.find((b) => index <= b.max);
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 320 104');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(svgNs, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  for (const edge of [50, 100, 200, 300].filter((v) => v <= top)) {
    add('line', { x1: left, x2: right, y1: y(edge), y2: y(edge), class: 'aqi-grid' });
    add('text', { x: left - 4, y: y(edge) + 3, class: 'aqi-tick' }, String(edge));
  }
  add('line', { x1: left, x2: right, y1: base, y2: base, class: 'aqi-axis' });
  const readout = el('p', 'aqi-readout', 'Halakan ke lajur untuk bacaan setiap jam.');
  hours.forEach((h, i) => {
    if (h.index === null) return;
    const x = left + i * slot + (slot - width) / 2;
    const yTop = Math.min(y(h.index), base - 2);
    const r = Math.min(2, (base - yTop) / 2);
    const bar = add('path', {
      d: `M${x} ${base}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + width - r}Q${x + width} ${yTop} ${x + width} ${yTop + r}V${base}Z`,
      fill: `var(--aqi-${band(h.index).id})`,
      class: 'aqi-bar',
    });
    // The hit target is the whole column slot, not just the bar.
    const hit = add('rect', { x: left + i * slot, y: plotTop, width: slot, height: base - plotTop, class: 'aqi-hit' });
    hit.addEventListener('pointerenter', () => {
      readout.textContent = `${clock(h.t)} · IPU ${h.index}, ${band(h.index).label}`;
      bar.classList.add('active');
    });
    hit.addEventListener('pointerleave', () => bar.classList.remove('active'));
  });
  const first = hours.find((h) => h.index !== null);
  add('text', { x: left, y: 100, class: 'aqi-tick start' }, clock(first.t));
  add('text', { x: right, y: 100, class: 'aqi-tick end' }, 'sekarang');

  const table = el('table', 'visually-hidden');
  table.createCaption().textContent = 'IPU anggaran setiap jam, 24 jam lalu';
  for (const h of hours) {
    const row = table.insertRow();
    row.append(el('th', '', clock(h.t)), el('td', '', h.index === null ? 'tiada data' : `${h.index}, ${band(h.index).label}`));
  }
  box.append(el('figcaption', '', 'IPU anggaran setiap jam, 24 jam lalu'), svg, readout, table);
  return box;
}

export function airQualitySection(state, air = null) {
  const section = el('section', 'local-block');
  section.append(el('h3', '', 'Kualiti udara'));
  if (air) {
    if (air.entry.status === 'loading') {
      section.append(el('p', 'local-status', 'Memuatkan anggaran kualiti udara…'));
    } else if (air.entry.status === 'error') {
      section.append(el('p', 'local-status', 'Anggaran kualiti udara tidak dapat dimuat.'), retryButton(state, air.key));
    } else if (!air.estimate) {
      section.append(el('p', 'local-status', 'Data model tidak mencukupi untuk anggaran.'));
    } else {
      const { index, band, pm25, pm10 } = air.estimate;
      const reading = el('p', `aqi-reading aqi-${band.id}`);
      reading.append(el('strong', '', String(index)), ` ${band.label}`);
      section.append(reading, el('p', 'local-status',
        `Anggaran: PM2.5 ${pm25} µg/m³, PM10 ${pm10} µg/m³ (purata 24 jam, model CAMS). Bukan IPU rasmi JAS.`));
      if (air.hours?.some((h) => h.index !== null)) section.append(aqiChart(state, air.hours, air.zone));
    }
  }
  const link = el('a', 'local-link', 'Semak IPU rasmi (JAS)');
  link.href = AIR_QUALITY_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  section.append(link);
  if (!air) section.append(el('p', 'local-status', 'Bacaan dikemas kini setiap jam daripada stesen Jabatan Alam Sekitar.'));
  return section;
}

// The month of JAKIM times for a city (null without a position), shared by
// every view that shows the same city.
export function prayerFor(state, city, now) {
  const { year, month, day } = cityDate(city.zone, now);
  const key = `solat|${city.lat},${city.lon}|${year}-${month}`;
  const entry = city.lat === null ? null
    : state.localData.get(key, `${PRAYER_API}/${city.lat}/${city.lon}?year=${year}&month=${month}`);
  const today = entry?.status === 'ok' && Array.isArray(entry.data.prayers)
    ? entry.data.prayers.find((p) => p.day === day) ?? null
    : null;
  return { key, entry, day, today };
}

export function nextPrayer(today, now) {
  if (!today) return null;
  return PRAYERS.find((field) => today[field] && today[field] > now.getTime() / 1000) ?? null;
}

// Rebuilt only when the data, the displayed minute or the 12/24h setting
// change, so buttons and links keep keyboard focus between ticks.
export function renderLocalPanel(state, panel, city, now, air = null) {
  const { iso } = cityDate(city.zone, now);
  const { key: prayerKey, entry: prayer, day } = prayerFor(state, city, now);
  const weatherKey = `cuaca|${city.name}`;
  const weather = state.localData.get(weatherKey, `${WEATHER_API}?contains=${encodeURIComponent(city.name)}@location__location_name&limit=50`);
  const renderKey = [prayerKey, prayer?.status, weather.status, air?.key, air?.entry.status, Math.floor(now.getTime() / MINUTE_MS), state.hour24, state.tempUnit].join('|');
  if (panel.dataset.key === renderKey) return;
  panel.dataset.key = renderKey;
  panel.replaceChildren(
    prayerSection(state, city, prayer, prayerKey, now, day),
    weatherSection(state, city, weather, weatherKey, iso),
    airQualitySection(state, air),
    ...(city.lat !== null && city.lon !== null ? [qiblaSection(city)] : []),
    el('p', 'local-source', `Waktu solat: JAKIM melalui waktusolat.app. Cuaca: MET Malaysia melalui data.gov.my.${
      air ? ' Kualiti udara: Copernicus CAMS melalui Open-Meteo (CC BY 4.0).' : ''}`),
  );
}

// ---------- Tabs: Jam dunia / Malaysia / Bandar Malaysia ----------

// The icon for MET Malaysia's wording of a forecast (an SVG element).
export function weatherIcon(text = '') {
  const t = text.toLowerCase();
  if (/ribut|petir/.test(t)) return icon('storm');
  if (/hujan/.test(t) && !/tiada hujan/.test(t)) return icon('rain');
  if (/jerebu/.test(t)) return icon('fog');
  if (/mendung|berawan/.test(t)) return icon('cloud');
  return icon('sun-cloud');
}

// JAKIM's Hijri date ("1448-09-05") as numbers.
export function hijriParts(today) {
  const [year, month, day] = String(today?.hijri ?? '').split('-').map(Number);
  return { year, month, day };
}
