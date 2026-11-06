// The "Kiraan detik" section: events counted down to, each set in a city's
// own time and saved in this browser (state.countdowns). Loaded once the
// section nears the screen, or at once when some are saved.

import { saveState } from './storage.js';
import { LOCAL_ZONE, cityName, formatUtcOffset, utcOffsetMinutes, zonedTime } from './time.js';
import { el, renderKeyed } from './util.js';

const MAX = 20;

// "1h 2j 3m 4s lagi": days, hours, minutes and seconds to go.
function left(ms) {
  if (ms <= 0) return 'Sudah berlalu';
  const s = Math.floor(ms / 1000);
  const parts = [[Math.floor(s / 86400), 'h'], [Math.floor(s / 3600) % 24, 'j'], [Math.floor(s / 60) % 60, 'm'], [s % 60, 's']];
  const first = parts.findIndex(([n]) => n > 0);
  return `${parts.slice(first === -1 ? 3 : first).map(([n, unit]) => `${n}${unit}`).join(' ')} lagi`;
}

const nameOf = (state, zone) => state.cities.find((c) => c.zone === zone)?.name ?? cityName(zone);
const placeOf = (state, zone) => (zone === LOCAL_ZONE ? 'waktu anda' : `di ${nameOf(state, zone)}`);

// The form itself is in index.html (so its space is held while this loads):
// here it gets its submit handler, and its button is switched on.
function startForm(state, form) {
  form.dataset.ready = 'true';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const status = form.querySelector('.countdown-status');
    if (state.countdowns.length >= MAX) {
      status.textContent = `Paling banyak ${MAX} kiraan; buang satu dahulu.`;
      return;
    }
    const [year, month, day] = form.elements.date.value.split('-').map(Number);
    const [hour, minute] = form.elements.time.value.split(':').map(Number);
    const zone = form.elements.zone.value;
    const title = form.elements.title.value.trim();
    state.countdowns = [...state.countdowns, { title, at: zonedTime(zone, year, month, day, hour, minute), zone }].sort((a, b) => a.at - b.at);
    saveState(state);
    status.textContent = `"${title}" ditambah.`;
    form.elements.title.value = '';
    state.refresh();
  });
  form.querySelector('button[type="submit"]').disabled = false;
}

export function renderCountdowns(state) {
  const box = document.getElementById('countdowns');
  const form = box.querySelector('.countdown-form');
  if (!form.dataset.ready) startForm(state, form);
  const now = Date.now();
  // The time zones offered: the reader's own, then each card's (once each).
  const zones = [LOCAL_ZONE, ...state.cities.map((c) => c.zone)].filter((z, i, all) => all.indexOf(z) === i);
  renderKeyed(form.elements.zone, zones.join('|'), () => zones.map((zone) => new Option(
    `${zone === LOCAL_ZONE ? 'Waktu anda' : nameOf(state, zone)} (${formatUtcOffset(utcOffsetMinutes(zone, new Date(now)))})`, zone,
  )));
  const list = box.querySelector('.countdown-list');
  // Rebuilt only when the list changes, so its buttons keep focus; the time left ticks in place.
  renderKeyed(list, `${JSON.stringify(state.countdowns)}|${state.hour24}|${state.cities.map((c) => c.zone).join()}`, () => (!state.countdowns.length
    ? [el('li', 'empty', 'Belum ada kiraan. Tambah satu di atas.')]
    : state.countdowns.map((c, i) => {
    const item = el('li', 'countdown');
    const when = new Date(c.at).toLocaleString('ms-MY', {
      timeZone: c.zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
    });
    const mine = c.zone === LOCAL_ZONE ? '' : ` · ${new Date(c.at).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12' })} waktu anda`;
    const remove = el('button', 'countdown-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Buang kiraan ${c.title}`);
    remove.addEventListener('click', () => {
      state.countdowns = state.countdowns.filter((_, j) => j !== i);
      saveState(state);
      state.refresh();
    });
    const time = el('p', 'countdown-left');
    time.dataset.at = String(c.at);
    item.append(el('h3', '', c.title), time, el('p', 'local-status', `${when} ${placeOf(state, c.zone)}${mine}`), remove);
    return item;
  })));
  for (const time of list.querySelectorAll('.countdown-left')) time.textContent = left(Number(time.dataset.at) - now);
}
