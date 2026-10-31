// A JAKIM zone's prayer times as calendar events. Shared by the month's .ics
// download and scripts/build-calendars.mjs (the calendars people subscribe
// to), so both carry the same events and UIDs. No DOM: it also runs in Node.

import { PRAYERS, PRAYER_TIMES } from './local-panel.js';

// Where a zone's subscribed calendar is published, relative to the site.
export function calendarPath(code) {
  return `kalendar/${code}.ics`;
}

// The name a calendar app shows for a subscribed zone.
export function calendarName(zone) {
  return `Waktu solat ${zone.code} (${zone.daerah})`;
}

// The five prayers of each day in `prayers` (waktusolat.app's month), each
// ten minutes long with a reminder at its time; syuruk is not a prayer.
export function prayerEvents(zone, year, month, prayers) {
  return prayers.flatMap((p) => PRAYERS.filter((field) => p[field]).map((field) => {
    const label = PRAYER_TIMES.find(([f]) => f === field)[1];
    return {
      uid: `${zone.code}-${year}-${month}-${p.day}-${field}@jam-dunia`,
      start: p[field] * 1000,
      end: p[field] * 1000 + 10 * 60000,
      title: `${label} (${zone.code})`,
      description: `Waktu solat JAKIM bagi zon ${zone.code}: ${zone.daerah}, ${zone.negeri}. Dari Jam Dunia.`,
      alarm: true,
    };
  }));
}
