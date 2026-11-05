// Prayer times for cities outside Malaysia (Malaysian ones use JAKIM's), worked
// out here from the Sun's position: no service to call, so it works offline.
// The method each country's authorities use sets the Sun's depth below the
// horizon at Subuh and Isyak; Asar is by the Shafi'i shadow rule, as in
// Malaysia. Checked against the ephem library while written; mosques may
// differ by a minute or two. No DOM: it also runs in Node.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;

export const METHODS = {
  MWL: { name: 'Liga Dunia Islam (MWL)', fajr: 18, isha: 17 },
  ISNA: { name: 'ISNA (Amerika Utara)', fajr: 15, isha: 15 },
  UMM_AL_QURA: { name: 'Umm al-Qura, Makkah', fajr: 18.5, ishaMinutes: 90 },
  EGYPT: { name: 'Lembaga Ukur Mesir', fajr: 19.5, isha: 17.5 },
  KARACHI: { name: 'Universiti Sains Islam Karachi', fajr: 18, isha: 18 },
  SINGAPORE: { name: 'MUIS Singapura', fajr: 20, isha: 18 },
  KEMENAG: { name: 'Kemenag Indonesia', fajr: 20, isha: 18 },
  TURKEY: { name: 'Diyanet Turki', fajr: 18, isha: 17 },
  TEHRAN: { name: 'Institut Geofizik Tehran', fajr: 17.7, isha: 14, maghrib: 4.5 },
  GULF: { name: 'Wilayah Teluk', fajr: 19.5, ishaMinutes: 90 },
  KUWAIT: { name: 'Kuwait', fajr: 18, isha: 17.5 },
  QATAR: { name: 'Qatar', fajr: 18, ishaMinutes: 90 },
  DUBAI: { name: 'Dubai', fajr: 18.2, isha: 18.2 },
};

const BY_ZONE = {
  'Asia/Riyadh': 'UMM_AL_QURA', 'Asia/Aden': 'UMM_AL_QURA', 'Asia/Kuwait': 'KUWAIT', 'Asia/Qatar': 'QATAR',
  'Asia/Dubai': 'DUBAI', 'Asia/Bahrain': 'GULF', 'Asia/Muscat': 'GULF', 'Asia/Tehran': 'TEHRAN',
  'Europe/Istanbul': 'TURKEY', 'Asia/Singapore': 'SINGAPORE', 'Asia/Brunei': 'SINGAPORE',
  'Asia/Jakarta': 'KEMENAG', 'Asia/Pontianak': 'KEMENAG', 'Asia/Makassar': 'KEMENAG', 'Asia/Jayapura': 'KEMENAG',
  'Asia/Karachi': 'KARACHI', 'Asia/Kolkata': 'KARACHI', 'Asia/Calcutta': 'KARACHI', 'Asia/Dhaka': 'KARACHI', 'Asia/Kabul': 'KARACHI',
  'Africa/Cairo': 'EGYPT', 'Asia/Beirut': 'EGYPT', 'Asia/Damascus': 'EGYPT', 'Asia/Amman': 'EGYPT', 'Africa/Khartoum': 'EGYPT',
};

// The method for a city: by its time zone, North America by ISNA, else MWL.
export function methodFor(city) {
  const key = BY_ZONE[city.zone] ?? (city.zone.startsWith('America/') && city.lat >= 15 ? 'ISNA' : 'MWL');
  return { key, ...METHODS[key] };
}

// The Sun's declination (radians) and the equation of time (hours) at `ms`.
function sun(ms) {
  const d = ms / DAY_MS - 10957.5;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD / 15;
  const eqt = q / 15 - ra;
  return { dec: Math.asin(Math.sin(e) * Math.sin(l)), eqt: eqt - 24 * Math.round(eqt / 24) };
}

// Prayer times on the city's calendar day `iso` (YYYY-MM-DD), as ms; a time
// the Sun never reaches (midsummer far north) is null.
export function prayerTimes(city, iso) {
  const method = methodFor(city);
  const [y, m, d] = iso.split('-').map(Number);
  const midnight = Date.UTC(y, m - 1, d); // UTC midnight; times below are UTC hours of this day
  const lat = city.lat * RAD;
  // Solar noon, then each time worked out twice: the Sun moves a little in between.
  const noonAt = (ms) => 12 - city.lon / 15 - sun(ms).eqt;
  const noon = noonAt(midnight + (12 - city.lon / 15) * 3600000);
  const at = (hours) => midnight + hours * 3600000;
  // Hours from noon until the Sun's centre is `depth` degrees below the horizon (null if it never is).
  const span = (depth, hours) => {
    const { dec } = sun(at(hours));
    const cos = (-Math.sin(depth * RAD) - Math.sin(dec) * Math.sin(lat)) / (Math.cos(dec) * Math.cos(lat));
    return Math.abs(cos) > 1 ? null : Math.acos(cos) / RAD / 15;
  };
  const time = (depth, side) => {
    let t = noon + side * 6;
    for (let i = 0; i < 2; i += 1) {
      const s = span(depth, t);
      if (s === null) return null;
      t = noon + side * s;
    }
    return t;
  };
  const asr = (() => {
    let t = noon + 3;
    for (let i = 0; i < 2; i += 1) {
      const { dec } = sun(at(t));
      if (Math.abs(lat - dec) >= Math.PI / 2) return null; // polar night: the Sun casts no noon shadow
      const altitude = Math.atan(1 / (1 + Math.tan(Math.abs(lat - dec))));
      const s = span(-altitude / RAD, t);
      if (s === null) return null;
      t = noon + s;
    }
    return t;
  })();
  const sunrise = time(0.833, -1);
  const sunset = time(0.833, 1);
  let fajr = time(method.fajr, -1);
  let isha = method.ishaMinutes ? (sunset === null ? null : sunset + method.ishaMinutes / 60) : time(method.isha, 1);
  // Far north the Sun may not sink that deep, or does so only near midnight:
  // Subuh and Isyak are then a share of the night set by the angle (the
  // "angle-based" rule most authorities there follow).
  if (sunrise !== null && sunset !== null) {
    const night = 24 - (sunset - sunrise);
    const before = (method.fajr / 60) * night;
    if (fajr === null || sunrise - fajr > before) fajr = sunrise - before;
    if (!method.ishaMinutes) {
      const after = (method.isha / 60) * night;
      if (isha === null || isha - sunset > after) isha = sunset + after;
    }
  }
  const maghrib = method.maghrib ? time(method.maghrib, 1) : sunset;
  const ms = (hours) => (hours === null ? null : Math.round(at(hours) / 60000) * 60000);
  return {
    method,
    // Zohor a minute after the Sun crosses the meridian, as is usual.
    fajr: ms(fajr), syuruk: ms(sunrise), dhuhr: ms(noon + 1 / 60), asr: ms(asr), maghrib: ms(maghrib), isha: ms(isha),
  };
}
