// The "Waktu solat" panel on a card for a city outside Malaysia: times worked
// out in the browser (js/prayer-calc.js). Loaded the first time a panel opens.

import { PRAYERS, PRAYER_TIMES } from './local-panel.js';
import { prayerTimes } from './prayer-calc.js';
import { qiblaSection } from './qibla.js';
import { MINUTE_MS, cityDate } from './time.js';
import { el } from './util.js';

export function renderWorldPrayer(state, panel, city, now) {
  const { iso } = cityDate(city.zone, now);
  const renderKey = ['dunia', iso, Math.floor(now.getTime() / MINUTE_MS), state.hour24].join('|');
  if (panel.dataset.key === renderKey) return;
  panel.dataset.key = renderKey;

  const times = prayerTimes(city, iso);
  const fmt = (ms) => new Date(ms).toLocaleTimeString('ms-MY', {
    timeZone: city.zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
  const next = PRAYERS.find((field) => times[field] !== null && times[field] > now.getTime());
  const section = el('section', 'local-block');
  const heading = el('h3', '', 'Waktu solat');
  heading.append(' ', el('small', '', times.method.name));
  const list = el('ul', 'prayer-times');
  for (const [field, label] of PRAYER_TIMES) {
    const item = el('li', field === next ? 'next' : '');
    item.append(el('span', '', label), el('strong', '', times[field] === null ? 'tiada' : fmt(times[field])));
    list.append(item);
  }
  section.append(heading, list);
  if (times.syuruk === null || times.maghrib === null) {
    section.append(el('p', 'local-status', 'Matahari tidak terbit atau tidak terbenam di sini hari ini, jadi sebahagian waktu ditulis "tiada".'));
  }
  if (next) {
    const label = PRAYER_TIMES.find(([field]) => field === next)[1];
    const minutes = Math.ceil((times[next] - now.getTime()) / MINUTE_MS);
    const wait = [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)}j`, minutes % 60 && `${minutes % 60}m`].filter(Boolean).join(' ');
    section.append(el('p', 'next-prayer', `Seterusnya: ${label} dalam ${wait}`));
  } else {
    section.append(el('p', 'next-prayer', 'Semua waktu solat hari ini telah berlalu.'));
  }
  panel.replaceChildren(
    section,
    qiblaSection(city),
    el('p', 'local-source', `Dikira dalam pelayar ini dengan kaedah ${times.method.name}; Asar ikut mazhab Syafie. `
      + 'Mungkin berbeza seminit dua daripada jadual masjid tempatan.'),
  );
}
