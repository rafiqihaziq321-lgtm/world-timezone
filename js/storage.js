// The saved list of cities and settings (localStorage).

import { GLOBE_CITIES } from '../globe.js';
import { CAPITAL_ZONES, zoneByCode } from './jakim-zones.js';
import { cityName, isValidZone } from './time.js';

export const STORAGE_KEY = 'world-timezone:v1';
export const DEFAULT_ZONES = ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];

// The viewer's working day, used for every city in the planner. Minutes from
// midnight; weekend days as Date#getDay() numbers (0 = Sunday).
export const DEFAULT_WORK = { start: 9 * 60, end: 17 * 60, weekend: [6, 0] };
// A city in the user's list. lat/lon are null when unknown; such a city
// still gets a card, just no dot on the globe.
export function makeCity(name, zone, lat = null, lon = null) {
  return { name, zone, lat, lon };
}

// The city a bare IANA zone stands for, e.g. "Asia/Tokyo" -> Tokyo, with its
// position when it is one of the globe's built-in cities.
export function cityForZone(zone) {
  const known = GLOBE_CITIES.find((c) => c.zone === zone);
  return makeCity(cityName(zone), zone, known?.lat ?? null, known?.lon ?? null);
}

export function defaultState() {
  // theme null = follow the system
  // prayerZone: the viewer's JAKIM zone (null until chosen); reminder: prayer-time notifications for it
  // tempUnit: 'c' or 'f', for every temperature shown
  return { cities: DEFAULT_ZONES.map(cityForZone), hour24: true, theme: null, work: { ...DEFAULT_WORK }, prayerZone: null, reminder: false, tempUnit: 'c' };
}

export function parseStoredCity(raw) {
  if (!raw || typeof raw.name !== 'string' || typeof raw.zone !== 'string' || !isValidZone(raw.zone)) return null;
  const coord = (n) => (Number.isFinite(n) ? n : null);
  return makeCity(raw.name, raw.zone, coord(raw.lat), coord(raw.lon));
}

// Saved working hours, or the defaults if missing or not a sensible range.
export function parseStoredWork(raw) {
  const minute = (n) => Number.isInteger(n) && n >= 0 && n <= 24 * 60;
  if (!raw || !minute(raw.start) || !minute(raw.end) || raw.start >= raw.end || !Array.isArray(raw.weekend)) return { ...DEFAULT_WORK };
  return { start: raw.start, end: raw.end, weekend: [...new Set(raw.weekend.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] };
}

export function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('localStorage tidak tersedia; guna tetapan lalai.', err);
    return defaultState();
  }
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const defaults = defaultState();
    let cities = defaults.cities;
    if (Array.isArray(parsed.cities)) {
      cities = parsed.cities.map(parseStoredCity).filter(Boolean);
    } else if (Array.isArray(parsed.zones)) {
      // Lists saved before cities existed held zone ids only.
      cities = parsed.zones.filter((z) => typeof z === 'string' && isValidZone(z)).map(cityForZone);
    }
    // Reminders were saved as { state } before zones: that state capital's zone, still on.
    const legacyZone = CAPITAL_ZONES[parsed.reminder?.state] ?? null;
    const prayerZone = zoneByCode(parsed.prayerZone)?.code ?? legacyZone;
    return {
      cities,
      hour24: typeof parsed.hour24 === 'boolean' ? parsed.hour24 : defaults.hour24,
      tempUnit: parsed.tempUnit === 'f' ? 'f' : defaults.tempUnit,
      theme: ['light', 'dark'].includes(parsed.theme) ? parsed.theme : defaults.theme,
      work: parseStoredWork(parsed.work),
      prayerZone,
      reminder: prayerZone !== null && (parsed.reminder === true || legacyZone !== null),
    };
  } catch (err) {
    console.warn('Data tersimpan rosak; guna tetapan lalai.', err);
    return defaultState();
  }
}

// While viewing a shared link (state.shared), the visible list is the sender's,
// so the viewer's own list (state.savedCities) is what gets stored.
export function saveState(state) {
  const cities = (state.shared ? state.savedCities : state.cities)
    .map(({ name, zone, lat, lon }) => ({ name, zone, lat, lon }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cities, hour24: state.hour24, theme: state.theme, work: state.work, prayerZone: state.prayerZone, reminder: state.reminder, tempUnit: state.tempUnit }));
  } catch (err) {
    console.warn('Gagal simpan tetapan; perubahan tidak akan kekal selepas reload.', err);
  }
}
