// The Moon for the Islamic calendar section: how full it is, its phase, the
// next new and full moon, and when it rises and sets at a place. Worked out
// here with the low-precision formulas of Meeus (Astronomical Algorithms),
// good to a few minutes; checked against the ephem library while written.
// No DOM: it also runs in Node.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const OBLIQUITY = 23.4397 * RAD;
const SUN_KM = 149598000;

// Days since J2000.0 (2000-01-01 12:00 UTC).
const days = (ms) => ms / DAY_MS - 10957.5;

function equatorial(lon, lat) {
  return {
    ra: Math.atan2(Math.sin(lon) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lon)),
    dec: Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lon)),
  };
}

function sunAt(d) {
  const m = (357.5291 + 0.98560028 * d) * RAD;
  const centre = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
  const lon = (280.46646 + 0.98564736 * d) * RAD + centre; // of date, like the Moon's
  return { ...equatorial(lon, 0), lon };
}

// The Moon's largest periodic terms (Meeus, ch. 47): enough to place new and
// full moon within about a quarter of an hour.
function moonAt(d) {
  const l = 218.316 + 13.176396 * d; // mean longitude
  const m = (134.963 + 13.064993 * d) * RAD; // mean anomaly
  const f = (93.272 + 13.229350 * d) * RAD; // argument of latitude
  const e = (297.850 + 12.190749 * d) * RAD; // mean elongation from the Sun
  const s = (357.529 + 0.98560028 * d) * RAD; // the Sun's mean anomaly
  const lon = l + 6.289 * Math.sin(m) + 1.274 * Math.sin(2 * e - m) + 0.658 * Math.sin(2 * e) + 0.214 * Math.sin(2 * m)
    - 0.185 * Math.sin(s) - 0.114 * Math.sin(2 * f) + 0.059 * Math.sin(2 * e - 2 * m) + 0.057 * Math.sin(2 * e - s - m)
    + 0.053 * Math.sin(2 * e + m) + 0.046 * Math.sin(2 * e - s) + 0.041 * Math.sin(m - s) - 0.035 * Math.sin(e)
    - 0.030 * Math.sin(s + m) + 0.015 * Math.sin(2 * e - 2 * f) - 0.013 * Math.sin(m + 2 * f) + 0.011 * Math.sin(m - 2 * f)
    + 0.011 * Math.sin(4 * e - m) + 0.010 * Math.sin(3 * m);
  const lat = 5.128 * Math.sin(f) + 0.281 * Math.sin(m + f) + 0.278 * Math.sin(m - f) + 0.173 * Math.sin(2 * e - f)
    + 0.055 * Math.sin(2 * e - m + f) + 0.046 * Math.sin(2 * e - m - f);
  const km = 385001 - 20905 * Math.cos(m) - 3699 * Math.cos(2 * e - m) - 2956 * Math.cos(2 * e) - 570 * Math.cos(2 * m)
    + 246 * Math.cos(2 * m - 2 * e) - 205 * Math.cos(s - 2 * e) - 171 * Math.cos(m + 2 * e);
  return { ...equatorial(lon * RAD, lat * RAD), lon: lon * RAD, km };
}

// How much of the disc is lit (0–1) and where in its month it is: 0 new,
// 0.25 first quarter, 0.5 full, 0.75 last quarter. The month is measured
// along the ecliptic, as new and full moon are defined.
export function moonPhase(ms) {
  const d = days(ms);
  const s = sunAt(d);
  const m = moonAt(d);
  const elongation = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const angle = Math.atan2(SUN_KM * Math.sin(elongation), m.km - SUN_KM * Math.cos(elongation));
  const turn = 2 * Math.PI;
  return { lit: (1 + Math.cos(angle)) / 2, phase: (((m.lon - s.lon) % turn) + turn) % turn / turn };
}

export const PHASE_NAMES = [
  [0.03, 'Bulan baharu'], [0.22, 'Sabit muda'], [0.28, 'Separuh pertama'], [0.47, 'Cembung muda'],
  [0.53, 'Purnama'], [0.72, 'Cembung tua'], [0.78, 'Separuh akhir'], [0.97, 'Sabit tua'], [1, 'Bulan baharu'],
];

export function phaseName(phase) {
  return PHASE_NAMES.find(([upTo]) => phase < upTo)[1];
}

// The first moment after `ms` the phase reaches `target` (0 new, 0.5 full),
// found hour by hour, then to the minute.
export function nextPhase(ms, target) {
  const gap = (t) => (moonPhase(t).phase - target + 1.5) % 1 - 0.5; // −0.5…0.5, rising through 0
  let t = ms;
  let before = gap(t);
  for (let i = 0; i < 31 * 24; i += 1) {
    const after = gap(t + 3600000);
    if (before < 0 && after >= 0) {
      let [lo, hi] = [t, t + 3600000];
      while (hi - lo > 60000) {
        const mid = (lo + hi) / 2;
        if (gap(mid) < 0) lo = mid; else hi = mid;
      }
      return hi;
    }
    t += 3600000;
    before = after;
  }
  return null;
}

// Height of the Moon's upper edge above the horizon, in degrees, as seen
// from the ground (parallax) through the air (refraction).
export function moonHeight(ms, lat, lon) {
  const d = days(ms);
  const m = moonAt(d);
  const hourAngle = (280.16 + 360.9856235 * d) * RAD + lon * RAD - m.ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(hourAngle));
  const parallax = Math.asin(6378.14 / m.km) * Math.cos(alt);
  const radius = Math.asin(1737.4 / m.km);
  return (alt - parallax + radius) / RAD + 34 / 60;
}

// Moonrise and moonset in the 24 hours from `dayStart` (ms), each null when
// the Moon does not rise or set that day; found ten minutes at a time.
export function moonTimes(dayStart, lat, lon) {
  const step = 600000;
  const out = { rise: null, set: null };
  let before = moonHeight(dayStart, lat, lon);
  for (let t = dayStart; t < dayStart + DAY_MS; t += step) {
    const after = moonHeight(t + step, lat, lon);
    if ((before < 0) !== (after < 0)) {
      const at = Math.round(t + (step * before) / (before - after));
      if (before < 0 && out.rise === null) out.rise = at;
      if (before >= 0 && out.set === null) out.set = at;
    }
    before = after;
  }
  return out;
}
