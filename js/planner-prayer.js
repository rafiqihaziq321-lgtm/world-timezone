// Prayer times in the meeting planner: for each city, the hours of the
// planned day that Zohor, Asar and Maghrib fall in. JAKIM's times for
// Malaysian cities (fetched as on their cards), the browser's own reckoning
// (js/prayer-calc.js) elsewhere. Loaded once the planner nears the screen.

import { PRAYER_TIMES, isMalaysian, prayerFor } from './local-panel.js';
import { prayerTimes } from './prayer-calc.js';
import { HOUR_MS, cityDate, formatClock } from './time.js';

const MARKED = ['dhuhr', 'asr', 'maghrib']; // the ones a working day meets

// { ready, rows }: rows[r][slot] lists "Zohor 13:10"… for that city and hour;
// ready is false while a city's JAKIM times are still loading.
export function prayerMarks(state, dayStart) {
  let ready = true;
  const rows = state.cities.map((city) => {
    const marks = {};
    if (city.lat === null || city.lon === null) return marks;
    // The day's 24 hours can span two of the city's dates.
    const days = [dayStart, dayStart + 23 * HOUR_MS].map((ms) => new Date(ms))
      .filter((d, i, all) => i === 0 || cityDate(city.zone, d).iso !== cityDate(city.zone, all[0]).iso);
    for (const date of days) {
      let times = null;
      if (isMalaysian(city)) {
        const { entry, today } = prayerFor(state, city, date);
        if (entry?.status === 'loading') ready = false;
        if (today) times = Object.fromEntries(MARKED.map((f) => [f, today[f] ? today[f] * 1000 : null]));
      } else {
        times = prayerTimes(city, cityDate(city.zone, date).iso);
      }
      for (const field of MARKED) {
        const at = times?.[field];
        const slot = at ? Math.floor((at - dayStart) / HOUR_MS) : -1;
        if (slot < 0 || slot > 23) continue;
        const label = PRAYER_TIMES.find(([f]) => f === field)[1];
        (marks[slot] ??= []).push(`${label} ${formatClock(state, city.zone, at)}`);
      }
    }
    return marks;
  });
  return { ready, rows };
}
