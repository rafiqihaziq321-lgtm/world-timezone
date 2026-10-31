// Writes <out>/<ZONE>.ics for every JAKIM zone: this month and the next in
// Malaysia, as the calendars people subscribe to from the month dialog.
// .github/workflows/pages.yml runs it before each deploy:
//
//   node scripts/build-calendars.mjs _site/kalendar --previous https://<site>/
//
// A zone whose times cannot be fetched keeps the copy already published at
// --previous, so subscribers never lose their events to an API outage; with
// neither, the build fails and the site stays as it was.
// ZONE_API and RETRY_MS (ms before the first retry) are for tests.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { icsCalendar } from '../js/calendar.js';
import { JAKIM_ZONES } from '../js/jakim-zones.js';
import { calendarName, calendarPath, prayerEvents } from '../js/prayer-calendar.js';
import { cityDate } from '../js/time.js';

const [outDir, flag, previous] = process.argv.slice(2);
if (!outDir || (flag !== undefined && (flag !== '--previous' || !previous))) {
  console.error('Usage: node scripts/build-calendars.mjs <out-dir> [--previous <published-site-url>]');
  process.exit(2);
}
const api = process.env.ZONE_API ?? 'https://api.waktusolat.app';
const retryMs = Number(process.env.RETRY_MS ?? 2000);
const now = Date.now();
const { year, month } = cityDate('Asia/Kuala_Lumpur', new Date(now));
const months = [{ year, month }, month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }];

// Three tries, waiting longer each time.
async function fetchMonth(code, y, m) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(`${api}/v2/solat/${code}?year=${y}&month=${m}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data?.prayers)) throw new Error('no prayers in the response');
      return data.prayers;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((resolve) => { setTimeout(resolve, retryMs * attempt); });
    }
  }
}

await mkdir(outDir, { recursive: true });
let kept = 0;
for (const zone of JAKIM_ZONES) {
  const file = join(outDir, `${zone.code}.ics`);
  try {
    const events = [];
    for (const m of months) events.push(...prayerEvents(zone, m.year, m.month, await fetchMonth(zone.code, m.year, m.month)));
    await writeFile(file, icsCalendar(events, now, { name: calendarName(zone), refreshHours: 12 }));
  } catch (err) {
    if (!previous) throw new Error(`${zone.code}: ${err.message}`);
    const res = await fetch(new URL(calendarPath(zone.code), previous));
    if (!res.ok) throw new Error(`${zone.code}: ${err.message}, and no published copy to keep (HTTP ${res.status})`);
    console.warn(`${zone.code}: ${err.message}; keeping the published copy`);
    await writeFile(file, await res.text());
    kept += 1;
  }
}
console.log(`${JAKIM_ZONES.length} calendars in ${outDir}${kept ? `, ${kept} kept from the published site` : ''}`);
