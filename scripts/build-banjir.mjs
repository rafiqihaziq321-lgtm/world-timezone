// Writes <out-file> (data/banjir.json on the site): every JPS river station
// above its Normal threshold, state by state, read from the water level tables
// at publicinfobanjir.water.gov.my. JPS publishes no API and allows no
// cross-origin reads, so the browser cannot ask it directly; this runs before
// each deploy, every 30 minutes (.github/workflows/pages.yml):
//
//   node scripts/build-banjir.mjs _site/data/banjir.json --previous https://<site>/
//
// A state whose table cannot be read keeps its entry from the copy published at
// --previous, with that entry's own reading time, so the page can say how old
// it is. A state with neither is listed under "missing"; the build never fails
// because JPS is down. JPS_BASE and RETRY_MS (ms before the first retry) are for tests.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [outFile, flag, previous] = process.argv.slice(2);
if (!outFile || (flag !== undefined && (flag !== '--previous' || !previous))) {
  console.error('Usage: node scripts/build-banjir.mjs <out-file> [--previous <published-site-url>]');
  process.exit(2);
}
const base = process.env.JPS_BASE ?? 'https://publicinfobanjir.water.gov.my';
const retryMs = Number(process.env.RETRY_MS ?? 2000);

// JPS's state codes, and the names the rest of the app uses. Labuan has no table.
const STATES = {
  JHR: 'Johor', KDH: 'Kedah', KEL: 'Kelantan', MLK: 'Melaka', NSN: 'Negeri Sembilan',
  PHG: 'Pahang', PLS: 'Perlis', PNG: 'Pulau Pinang', PRK: 'Perak', PTJ: 'W.P. Putrajaya',
  SAB: 'Sabah', SEL: 'Selangor', SRK: 'Sarawak', TRG: 'Terengganu', WLH: 'W.P. Kuala Lumpur',
};
// The threshold columns, lowest first, and the level reaching each one names.
const LEVELS = [['Alert', 'waspada'], ['Warning', 'amaran'], ['Danger', 'bahaya']];

const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const number = (value) => (value === '' || value === undefined ? NaN : Number(value));

// "08/11/2026 18:00" (Malaysia time) as an ISO instant, or null.
function readingTime(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value ?? '');
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+08:00`).toISOString() : null;
}

// One state's table: how many stations report a level, and those above Normal.
// Throws when the page is not the table JPS normally serves, so a changed or
// broken page keeps the published copy instead of reporting "all clear".
function parseTable(html) {
  if (!/id='normaltable1'/.test(html) || !/Tahap Nilai Ambang/.test(html)) throw new Error('not a JPS water level table');
  let stations = 0;
  const above = [];
  for (const row of html.split("<tr  class='item'>").slice(1)) {
    const cells = Object.fromEntries([...row.matchAll(/<td data-th='([^']*)'[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [m[1], text(m[2])]));
    const wl = number(cells.wl);
    if (!Number.isFinite(wl)) continue;
    stations += 1;
    // The highest threshold the river has reached; a threshold JPS leaves blank is skipped.
    let level = null;
    for (const [column, name] of LEVELS) if (wl >= number(cells[column])) level = name;
    if (!level) continue;
    above.push({
      name: cells['Station Name'],
      district: cells.District,
      river: cells['Sub River Basin (mm)'] || cells['Main Basin (mm)'],
      level,
      wl,
      thresholds: Object.fromEntries(LEVELS.map(([column, name]) => [name, Number.isFinite(number(cells[column])) ? number(cells[column]) : null])),
      at: readingTime(cells['Last Update']),
    });
  }
  const rank = (s) => LEVELS.findIndex(([, name]) => name === s.level);
  above.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  return { stations, above };
}

// Three tries, waiting longer each time.
async function fetchState(code) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(`${base}/aras-air/data-paras-air/aras-air-data/?state=${code}&district=ALL&station=ALL`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseTable(await res.text());
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((resolve) => { setTimeout(resolve, retryMs * attempt); });
    }
  }
}

async function publishedCopy() {
  if (!previous) return null;
  try {
    const res = await fetch(new URL('data/banjir.json', previous));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`No published copy to fall back on: ${err.message}`);
    return null;
  }
}

const out = { source: `${base}/`, built: new Date().toISOString(), states: {}, missing: [] };
let published;
for (const [code, name] of Object.entries(STATES)) {
  try {
    out.states[name] = { fetched: new Date().toISOString(), ...(await fetchState(code)) };
  } catch (err) {
    published ??= (await publishedCopy()) ?? {};
    const kept = published.states?.[name];
    console.warn(`${code}: ${err.message}; ${kept ? 'keeping the published copy' : 'no published copy to keep'}`);
    if (kept) out.states[name] = kept;
    else out.missing.push(name);
  }
}
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(out)}\n`);
const above = Object.values(out.states).reduce((n, s) => n + s.above.length, 0);
console.log(`${Object.keys(out.states).length} states, ${above} stations above Normal, in ${outFile}${out.missing.length ? `; missing: ${out.missing.join(', ')}` : ''}`);
