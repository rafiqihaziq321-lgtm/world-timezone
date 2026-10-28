// Share links that carry a list of cities.

import { GLOBE_CITIES, cityKey } from '../globe.js';
import { cityForZone, makeCity } from './storage.js';
import { cityName, isValidZone } from './time.js';

export const shareStatusEl = document.getElementById('share-status');

// A city in a share link: its zone, plus "~Name" when the name is not simply
// the zone's own city ("Asia/Tokyo", "Asia/Kuala_Lumpur~Johor Bahru").
export function shareToken(city) {
  const token = city.name === cityName(city.zone) ? city.zone : `${city.zone}~${city.name}`;
  // Keep "/" readable; everything else is percent-encoded.
  return encodeURIComponent(token).replace(/%2F/g, '/');
}

export function parseShareToken(token) {
  const [zone, ...rest] = token.trim().split('~');
  if (zone === '' || !isValidZone(zone)) return null;
  const name = rest.join('~').trim();
  if (!name) return cityForZone(zone);
  const known = GLOBE_CITIES.find((c) => c.zone === zone && c.name === name);
  return makeCity(name, zone, known?.lat ?? null, known?.lon ?? null);
}

// The meeting lengths a link may carry, in minutes (the planner offers these).
const LENGTHS = [30, 60, 90, 120, 180];

// Reads `?bandar=<token>,<token>&masa=<ISO instant>`, and a planned meeting:
// `&mesyuarat=<ISO instant>&tempoh=<minutes>&tajuk=<text>`. Unknown zones and
// repeats are dropped; a missing or unusable part comes back as null.
export function readShareParams() {
  const params = new URLSearchParams(window.location.search);
  const cities = [];
  for (const city of (params.get('bandar') ?? '').split(',').map(parseShareToken)) {
    if (city && !cities.some((c) => cityKey(c) === cityKey(city))) cities.push(city);
  }
  const time = Date.parse(params.get('masa') ?? '');
  const start = Date.parse(params.get('mesyuarat') ?? '');
  const duration = Number(params.get('tempoh'));
  return {
    cities: cities.length ? cities : null,
    time: Number.isFinite(time) ? time : null,
    meeting: Number.isFinite(start) ? {
      start,
      duration: LENGTHS.includes(duration) ? duration : 60,
      title: (params.get('tajuk') ?? '').trim().slice(0, 120) || 'Mesyuarat',
    } : null,
  };
}

export function buildShareUrl(state) {
  let query = `?bandar=${state.cities.map(shareToken).join(',')}`;
  if (state.viewTime !== null) query += `&masa=${new Date(state.viewTime).toISOString().replace('.000Z', 'Z')}`;
  // A chosen meeting travels too, so the link opens on it.
  if (state.plannerPick !== null) {
    query += `&mesyuarat=${new Date(state.plannerPick).toISOString().replace('.000Z', 'Z')}&tempoh=${state.plannerDuration}`;
    if (state.plannerTitle.trim() && state.plannerTitle.trim() !== 'Mesyuarat') query += `&tajuk=${encodeURIComponent(state.plannerTitle.trim())}`;
  }
  return `${window.location.origin}${window.location.pathname}${query}`;
}

export function clearShareParams() {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
}

// `statusEl` is where the outcome is shown: the header's line by default.
export async function copyShareLink(state, statusEl = shareStatusEl) {
  const url = buildShareUrl(state);
  statusEl.hidden = false;
  try {
    await navigator.clipboard.writeText(url);
    statusEl.textContent = 'Pautan disalin ke clipboard.';
  } catch (err) {
    // Clipboard can be blocked (permissions, insecure context): let the user copy by hand.
    console.info('Clipboard tidak tersedia; papar pautan untuk disalin manual.', err);
    statusEl.textContent = 'Salin pautan ini: ';
    const field = document.createElement('input');
    field.readOnly = true;
    field.value = url;
    field.setAttribute('aria-label', 'Pautan kongsi');
    statusEl.append(field);
    field.select();
  }
}
