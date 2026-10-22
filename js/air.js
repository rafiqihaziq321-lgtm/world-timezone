// Estimated air quality from Open-Meteo (CAMS model).

import { MAP_PLACES } from './places.js';
import { HOUR_MS } from './time.js';

export const AIR_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
// Malaysia's 24-hour ambient air standards (MAAQS 2020), µg/m³.
export const PM25_STANDARD = 35;
export const PM10_STANDARD = 100;
// The IPU's published bands.
export const AIR_BANDS = [
  { max: 50, id: 'good', label: 'Baik' },
  { max: 100, id: 'moderate', label: 'Sederhana' },
  { max: 200, id: 'unhealthy', label: 'Tidak sihat' },
  { max: 300, id: 'very-unhealthy', label: 'Sangat tidak sihat' },
  { max: Infinity, id: 'hazardous', label: 'Berbahaya' },
];

// JAS does not publish the breakpoints it converts PM readings with, so this
// is an IPU-like estimate, not the IPU: 100 means the worse of PM2.5 and PM10
// is at its 24-hour standard, from modelled rather than measured levels.
// `hourly` is Open-Meteo's series with unix times; null if under 18 hours.
export function estimateAirIndex(hourly, nowMs) {
  const from = nowMs / 1000 - 24 * 3600;
  const mean = (values) => {
    const recent = (hourly?.time ?? []).flatMap((t, i) => (t > from && t <= nowMs / 1000 && Number.isFinite(values?.[i]) ? [values[i]] : []));
    return recent.length >= 18 ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  };
  const pm25 = mean(hourly?.pm2_5);
  const pm10 = mean(hourly?.pm10);
  if (pm25 === null || pm10 === null) return null;
  const index = Math.round(Math.max((pm25 / PM25_STANDARD) * 100, (pm10 / PM10_STANDARD) * 100));
  return { index, band: AIR_BANDS.find((b) => index <= b.max), pm25: Math.round(pm25), pm10: Math.round(pm10) };
}

// The index for each of the last 24 hours on its own (the same scale as the
// estimate, but hourly levels rather than a 24-hour mean). null: no data.
export function hourlyAirIndex(hourly, nowMs) {
  const nowS = nowMs / 1000;
  return (hourly?.time ?? []).flatMap((t, i) => {
    if (!(t > nowS - 24 * 3600 && t <= nowS)) return [];
    const pm25 = hourly.pm2_5?.[i];
    const pm10 = hourly.pm10?.[i];
    const index = Number.isFinite(pm25) && Number.isFinite(pm10)
      ? Math.round(Math.max((pm25 / PM25_STANDARD) * 100, (pm10 / PM10_STANDARD) * 100)) : null;
    return [{ t, index }];
  });
}

// One request for every map place, refreshed each hour; Open-Meteo returns
// a list in the order the coordinates were given.
export function stateAirQuality(state) {
  const nowMs = Date.now();
  const key = `udara|${Math.floor(nowMs / HOUR_MS)}`;
  const coords = (field) => MAP_PLACES.map((s) => s[field]).join(',');
  const entry = state.localData.get(key, `${AIR_API}?latitude=${coords('lat')}&longitude=${coords('lon')}&hourly=pm10,pm2_5&past_days=1&forecast_days=1&timeformat=unixtime`);
  return {
    key,
    entry,
    forState(s) {
      const rows = entry.status === 'ok' && Array.isArray(entry.data) ? entry.data : [];
      const hourly = rows[MAP_PLACES.indexOf(s)]?.hourly;
      return { key, entry, zone: s.zone, estimate: estimateAirIndex(hourly, nowMs), hours: hourlyAirIndex(hourly, nowMs) };
    },
  };
}

// ---------- 3D map of Malaysia (MapLibre, OpenFreeMap, AWS terrain) ----------
