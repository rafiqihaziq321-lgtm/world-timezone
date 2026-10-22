// Time zones, offsets, clock formatting and the sun.
// Some browsers (e.g. Chromium) list legacy IANA names. Swap in the current
// names so users searching "Kolkata" or "Kyiv" find them.
export const RENAMED_ZONES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
};

export function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

export const ALL_ZONES = Intl.supportedValuesOf('timeZone')
  .map((z) => (RENAMED_ZONES[z] && isValidZone(RENAMED_ZONES[z]) ? RENAMED_ZONES[z] : z));
export const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const MINUTE_MS = 60 * 1000;
export const QUARTER_MS = 15 * MINUTE_MS;
export const HOUR_MS = 60 * MINUTE_MS;
// "America/Argentina/Buenos_Aires" -> "Buenos Aires"
export function cityName(zone) {
  return zone.split('/').pop().replace(/_/g, ' ');
}

// Offset of `zone` from UTC in minutes at instant `date`, derived from the
// zone's wall-clock time so DST is handled by Intl rather than by us.
export function utcOffsetMinutes(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// 195 -> "+3j 15m", -120 -> "−2j"
export function signedDuration(minutes) {
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}j${m ? ` ${m}m` : ''}`;
}

// 480 -> "UTC+8", 330 -> "UTC+5:30", -240 -> "UTC−4"
export function formatUtcOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

export function formatDiff(minutes) {
  if (minutes === 0) return 'Sama dengan waktu anda';
  return `${signedDuration(minutes)} dari waktu anda`;
}

// The instant every clock shows: live now, or the time picked with the slider
// or planner (state.viewTime, epoch ms).
export function displayDate(state) {
  return state.viewTime === null ? new Date() : new Date(state.viewTime);
}

export function floorToQuarter(ms) {
  return Math.floor(ms / QUARTER_MS) * QUARTER_MS;
}

export function minuteOfDay(zone, ms) {
  const minutes = Math.floor(ms / MINUTE_MS) + utcOffsetMinutes(zone, new Date(ms));
  return ((minutes % 1440) + 1440) % 1440;
}

// Day of the week (0 = Sunday) by the zone's own calendar.
export function weekdayOf(zone, ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(ms);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

export function minuteText(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function hourLabel(minutes, hour24) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const shown = hour24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  return m ? `${shown}:${String(m).padStart(2, '0')}` : shown;
}

// Part of the day by the city's own clock; drives the card background and icon.
export const PHASES = {
  dawn: { icon: '🌅', name: 'Fajar' },
  day: { icon: '☀️', name: 'Siang' },
  dusk: { icon: '🌇', name: 'Senja' },
  night: { icon: '🌙', name: 'Malam' },
};

// Fixed hours, for places whose position we do not know (the viewer's own
// zone, and cities added by zone alone).
export function dayPhase(minutes) {
  if (minutes >= 5 * 60 && minutes < 7 * 60) return 'dawn';
  if (minutes >= 7 * 60 && minutes < 17 * 60) return 'day';
  if (minutes >= 17 * 60 && minutes < 19 * 60) return 'dusk';
  return 'night';
}

// Sunrise and sunset (epoch ms) on the city's calendar day containing
// `ms`, by the standard sunrise equation (accurate to a minute or two).
// In polar day or night there is no sunrise or sunset: { polar: 'day' | 'night' }.
export function sunTimes(city, ms) {
  const rad = Math.PI / 180;
  const { year, month, day } = cityDate(city.zone, new Date(ms));
  const n = Math.round(Date.UTC(year, month - 1, day, 12) / 864e5 + 2440587.5 - 2451545);
  const meanNoon = n - city.lon / 360;
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
  const centre = 1.9148 * Math.sin(anomaly * rad) + 0.02 * Math.sin(2 * anomaly * rad) + 0.0003 * Math.sin(3 * anomaly * rad);
  const ecliptic = (anomaly + centre + 180 + 102.9372) % 360;
  const transit = 2451545 + meanNoon + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * ecliptic * rad);
  const declination = Math.asin(Math.sin(ecliptic * rad) * Math.sin(23.4397 * rad));
  const lat = city.lat * rad;
  // -0.833°: the sun's radius plus refraction at the horizon.
  const cosHour = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(declination)) / (Math.cos(lat) * Math.cos(declination));
  if (cosHour > 1) return { polar: 'night' };
  if (cosHour < -1) return { polar: 'day' };
  const half = Math.acos(cosHour) / rad / 360;
  const toMs = (julian) => (julian - 2440587.5) * 864e5;
  return { rise: toMs(transit - half), set: toMs(transit + half) };
}

// Dawn and dusk are the hour either side of sunrise and sunset.
export function cityPhase(city, ms) {
  if (city.lat === null || city.lon === null) return dayPhase(minuteOfDay(city.zone, ms));
  const sun = sunTimes(city, ms);
  if (sun.polar) return sun.polar;
  if (Math.abs(ms - sun.rise) < HOUR_MS) return 'dawn';
  if (Math.abs(ms - sun.set) < HOUR_MS) return 'dusk';
  return ms > sun.rise && ms < sun.set ? 'day' : 'night';
}

// The year, month, day and ISO date of `now` on the city's own calendar.
export function cityDate(zone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), iso: `${get('year')}-${get('month')}-${get('day')}` };
}

export function formatClock(state, zone, ms) {
  return new Date(ms).toLocaleTimeString('ms-MY', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
}

// MET Malaysia dates and times carry no zone; they are Malaysian time.
export function parseMyt(text) {
  if (!text) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}+08:00`);
}

export function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
