// The city cards: creating, ordering and describing them.

import { cityKey } from '../globe.js';
import { icon } from './icons.js';
import { isMalaysian, retryButton } from './local-panel.js';
import { saveState } from './storage.js';
import { HOUR_MS, LOCAL_ZONE, MINUTE_MS, PHASES, cityDate, cityPhase, formatClock, formatUtcOffset, minuteText, nextOffsetChange, signedDuration, sunTimes, utcOffsetMinutes, zonedTime } from './time.js';
import { el, renderKeyed } from './util.js';

export const clocksEl = document.getElementById('clocks');
const undoEl = document.getElementById('undo-bar');
// Sunrise 07:05 · sunset 19:12 by the city's clock; empty without a position.
export function renderSunLine(state, node, city, now) {
  if (city.lat === null || city.lon === null) return;
  const { iso } = cityDate(city.zone, now);
  renderKeyed(node, `${iso}|${state.hour24}`, () => {
    const sun = sunTimes(city, now.getTime());
    if (sun.polar === 'day') return [icon('sun'), ' Matahari tidak terbenam hari ini'];
    if (sun.polar === 'night') return [icon('moon'), ' Matahari tidak terbit hari ini'];
    const clock = (ms) => formatClock(state, city.zone, ms);
    const rise = el('span', 'visually-hidden', 'Terbit');
    const set = el('span', 'visually-hidden', 'terbenam');
    return [icon('sunrise'), rise, ` ${clock(sun.rise)} · `, icon('sunset'), set, ` ${clock(sun.set)}`];
  });
}

// A clock change (daylight saving) within the week, in that city's words:
// worked out once an hour, not every second.
export function renderDstLine(state, node, city, now) {
  renderKeyed(node, `${Math.floor(now.getTime() / HOUR_MS)}|${state.hour24}`, () => {
    const change = nextOffsetChange(city.zone, now.getTime());
    node.hidden = change === null;
    if (!change) return [];
    const wall = (offset) => new Date(change.at + offset * MINUTE_MS).toLocaleTimeString('ms-MY', {
      timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
    });
    const day = new Date(change.at + change.to * MINUTE_MS).toLocaleDateString('ms-MY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });
    return [icon('clock'), ` ${day}: jam ${change.to > change.from ? 'dimajukan' : 'diundur'} dari ${wall(change.from)} ke ${wall(change.to)} (${formatUtcOffset(change.from)} → ${formatUtcOffset(change.to)})`];
  });
}

// A city's calendar day, midnight to midnight, as runs of one part of the day
// (night, dawn, day, dusk), sampled every 5 minutes by the rule that names the
// card's phase. Polar days and nights come out as one run. Times are epoch ms.
export function daySegments(city, ms) {
  const { year, month, day } = cityDate(city.zone, new Date(ms));
  const start = zonedTime(city.zone, year, month, day, 0, 0);
  const end = zonedTime(city.zone, year, month, day + 1, 0, 0);
  const runs = [];
  for (let t = start; t < end; t += 5 * MINUTE_MS) {
    const phase = cityPhase(city, t + 2.5 * MINUTE_MS);
    const to = Math.min(t + 5 * MINUTE_MS, end);
    if (runs.at(-1)?.phase === phase) runs.at(-1).to = to;
    else runs.push({ phase, from: t, to });
  }
  return { start, end, runs };
}

// The sun strip under a card's clock (DESIGN.md): drawn once a day, with a mark
// at the time shown that moves every tick. Its words are the phase name beside it.
export function renderSunStrip(card, city, now) {
  const strip = card.querySelector('.sun-strip');
  renderKeyed(strip.firstElementChild, `${cityDate(city.zone, now).iso}|${city.lat}|${city.lon}`, () => {
    const { start, end, runs } = daySegments(city, now.getTime());
    Object.assign(strip.dataset, { start, end });
    return runs.map(({ phase, from, to }) => {
      const run = el('span', phase);
      run.style.width = `${((to - from) / (end - start)) * 100}%`;
      return run;
    });
  });
  const { start, end } = strip.dataset;
  strip.lastElementChild.style.left = `${((now.getTime() - start) / (end - start)) * 100}%`;
}

export const ANALOG_TICKS = Array.from({ length: 12 }, (_, i) => {
  const major = i % 3 === 0;
  return `<line class="tick" x1="50" y1="${major ? 8 : 10}" x2="50" y2="${major ? 16 : 14}" transform="rotate(${i * 30} 50 50)"/>`;
}).join('');

export function createCard(state, city) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.zone = city.zone;
  card.dataset.key = cityKey(city);
  card.innerHTML = `
    <div class="card-head">
      <button class="drag-handle" type="button"></button>
      <span class="phase" aria-hidden="true"></span>
      <h3 class="city"></h3>
      <span class="utc"></span>
      <button class="person-edit" type="button"></button>
    </div>
    <div class="card-body">
      <div>
        <div class="meta person" hidden></div>
        <div class="time"></div>
        <div class="meta date"></div>
        <div class="meta diff"></div>
        <div class="meta sun"></div>
        <div class="meta dst" hidden></div>
        <div class="meta weather"></div>
      </div>
      <svg class="analog" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="face" cx="50" cy="50" r="46"/>
        ${ANALOG_TICKS}
        <line class="hand hour" x1="50" y1="54" x2="50" y2="28"/>
        <line class="hand minute" x1="50" y1="56" x2="50" y2="16"/>
        <line class="hand second" x1="50" y1="60" x2="50" y2="12"/>
        <circle class="pin" cx="50" cy="50" r="3"/>
      </svg>
    </div>
    <div class="day-line">
      <span class="phase-name"></span>
      <div class="sun-strip" aria-hidden="true"><div class="sun-runs"></div><span class="sun-now"></span></div>
    </div>
    <div class="hourly" hidden></div>
    <button class="remove" type="button"></button>`;
  card.querySelector('.city').textContent = city.name;
  card.setAttribute('aria-label', city.name);
  // Whose city this is and their working day, set in a dialog loaded on first
  // use. The card is kept when the list changes, so the city is looked up anew.
  const edit = card.querySelector('.person-edit');
  edit.append(icon('person'));
  edit.setAttribute('aria-label', `Nama dan waktu kerja untuk ${city.name}`);
  edit.hidden = state.shared; // a shared list is the sender's: nothing here would be saved
  edit.addEventListener('click', () => import('./person-dialog.js').then((m) => {
    m.openPersonDialog(state, state.cities.find((c) => cityKey(c) === card.dataset.key));
  }, (err) => console.warn('Jam Dunia: dialog nama gagal dimuat.', err)));
  setupReorder(state, card, city);
  const remove = card.querySelector('.remove');
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Buang ${city.name}`);
  remove.addEventListener('click', () => {
    card.classList.add('leaving');
    // Only the card's own leaving animation: its panels' opening animations bubble here too.
    card.addEventListener('animationend', function leave(e) {
      if (e.target !== card) return;
      card.removeEventListener('animationend', leave);
      const index = state.cities.findIndex((c) => cityKey(c) === cityKey(city));
      state.cities = state.cities.filter((c) => cityKey(c) !== cityKey(city));
      saveState(state);
      renderCards(state);
      state.refresh();
      offerUndo(state, city, index);
    });
  });
  // Malaysian cities: JAKIM prayer times and MET weather. Elsewhere, prayer
  // times worked out in the browser, for any city whose position is known.
  const malaysian = isMalaysian(city);
  if (malaysian || (city.lat !== null && city.lon !== null)) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'local-toggle';
    toggle.textContent = malaysian ? 'Solat & cuaca' : 'Waktu solat';
    toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = malaysian ? 'local-panel' : 'local-panel world-prayer';
    panel.hidden = true;
    toggle.addEventListener('click', () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) state.refresh(); // fetches start only once the panel is opened
    });
    card.append(toggle, panel);
  }
  return card;
}

// A city outside Malaysia: its panel's code is fetched the first time one opens.
export function renderWorldPrayer(state, panel, city, now) {
  const key = 'modul-solat-dunia';
  const mod = state.localData.get(key, () => import('./world-prayer.js'));
  if (mod.status === 'ok') mod.data.renderWorldPrayer(state, panel, city, now);
  else renderKeyed(panel, mod.status, () => (mod.status === 'error'
    ? [el('p', 'local-status', 'Waktu solat gagal dimuat. '), retryButton(state, key)]
    : [el('p', 'local-status', 'Memuatkan waktu solat…')]));
}

// Cards are reordered by dragging their handle (mouse or touch) or with the
// arrow keys on it. The new order is saved, and the planner and globe follow it.
export function commitOrder(state) {
  const keys = [...clocksEl.querySelectorAll('.card')].map((c) => c.dataset.key);
  const order = keys.map((key) => state.cities.find((c) => cityKey(c) === key));
  if (order.every((c, i) => c === state.cities[i])) return;
  state.cities = order;
  saveState(state);
  state.refresh();
}

export function setupReorder(state, card, city) {
  const handle = card.querySelector('.drag-handle');
  handle.textContent = '⠿';
  handle.setAttribute('aria-label', `Susun semula ${city.name} (seret, atau guna kekunci anak panah)`);
  const status = document.getElementById('reorder-status');

  handle.addEventListener('keydown', (e) => {
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const cards = [...clocksEl.querySelectorAll('.card')];
    const to = cards.indexOf(card) + step;
    if (to < 0 || to >= cards.length) return;
    if (step < 0) cards[to].before(card);
    else cards[to].after(card);
    handle.focus(); // moving the element drops focus in some browsers
    commitOrder(state);
    status.textContent = `${city.name} kini di kedudukan ${to + 1} daripada ${cards.length}.`;
  });

  handle.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const box = card.getBoundingClientRect();
    const grab = { x: down.clientX - box.left, y: down.clientY - box.top };
    card.classList.add('dragging');

    // The card under the pointer, other than the one being dragged, takes
    // its place; the dragged card then follows the pointer from its new slot.
    const pointer = { x: down.clientX, y: down.clientY };
    const place = () => {
      const target = document.elementsFromPoint(pointer.x, pointer.y)
        .map((node) => node.closest('.card'))
        .find((c) => c && c !== card && c.parentElement === clocksEl);
      if (target) {
        const cards = [...clocksEl.children];
        if (cards.indexOf(target) > cards.indexOf(card)) target.after(card);
        else target.before(card);
      }
      card.style.transform = '';
      const slot = card.getBoundingClientRect();
      card.style.transform = `translate(${pointer.x - grab.x - slot.left}px, ${pointer.y - grab.y - slot.top}px)`;
    };
    // Listened for on window: moving the card in the DOM drops pointer capture.
    const move = (e) => {
      if (e.pointerId !== down.pointerId) return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      place();
    };
    // Holding the card near the top or bottom of the window scrolls the page,
    // faster the closer it is, so a card can travel past the visible ones.
    const EDGE = 64;
    let frame = requestAnimationFrame(function scroll() {
      const top = document.querySelector('.site-nav').getBoundingClientRect().bottom;
      const depth = pointer.y < top + EDGE ? pointer.y - (top + EDGE)
        : pointer.y > innerHeight - EDGE ? pointer.y - (innerHeight - EDGE) : 0;
      if (depth) {
        window.scrollBy(0, Math.max(-1, Math.min(1, depth / EDGE)) * 16);
        place();
      }
      frame = requestAnimationFrame(scroll);
    });
    const end = (e) => {
      if (e.pointerId !== down.pointerId) return;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      card.classList.remove('dragging');
      card.style.transform = '';
      commitOrder(state);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Keeps existing card elements so only added cards animate in.
export function renderCards(state) {
  const existing = new Map([...clocksEl.querySelectorAll('.card')].map((c) => [c.dataset.key, c]));
  clocksEl.replaceChildren();
  if (state.cities.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Tiada bandar. Tambah satu di atas atau klik bandar pada glob.';
    clocksEl.append(p);
    return;
  }
  for (const city of state.cities) {
    const card = existing.get(cityKey(city)) ?? createCard(state, city);
    showPerson(card, city);
    clocksEl.append(card);
  }
  balanceColumns();
}

// The person's name and own working day on a card, when set.
function showPerson(card, city) {
  const person = card.querySelector('.person');
  person.hidden = !city.label && !city.work;
  person.textContent = [city.label, city.work && `kerja ${minuteText(city.work.start)}–${minuteText(city.work.end)}`].filter(Boolean).join(' · ');
}

// A removed card can be put back, where it was, for a few seconds. The
// pending timer lives on the bar itself, so a second removal replaces the first.
function offerUndo(state, city, index) {
  clearTimeout(Number(undoEl.dataset.timer));
  const restore = el('button', 'btn secondary', 'Batal');
  restore.type = 'button';
  restore.addEventListener('click', () => {
    clearTimeout(Number(undoEl.dataset.timer));
    undoEl.hidden = true;
    if (state.cities.some((c) => cityKey(c) === cityKey(city))) return;
    state.cities.splice(Math.min(index, state.cities.length), 0, city);
    saveState(state);
    renderCards(state);
    state.refresh();
  });
  undoEl.replaceChildren(el('span', '', `${city.name} dibuang.`), restore);
  undoEl.hidden = false;
  undoEl.dataset.timer = String(setTimeout(() => { undoEl.hidden = true; }, 8000));
  restore.focus(); // the removed card's button is gone; keyboard focus lands here
}

// As many columns as fit, then as few as keep the same number of rows, so the
// last row is as full as it can be: 4 cards sit 4 across or 2 + 2, never 3 + 1.
export function balanceColumns() {
  const count = clocksEl.querySelectorAll('.card').length;
  const width = clocksEl.clientWidth;
  if (count === 0 || width === 0) {
    clocksEl.style.removeProperty('--cols');
    return;
  }
  const style = getComputedStyle(clocksEl);
  const min = parseFloat(style.getPropertyValue('--card-min'));
  const gap = parseFloat(style.columnGap) || 0;
  const fit = Math.max(1, Math.floor((width + gap) / (min + gap)));
  const rows = Math.ceil(count / fit);
  clocksEl.style.setProperty('--cols', String(Math.ceil(count / rows)));
}

// Returns false when the city is already listed.
export function addCity(state, city) {
  if (state.cities.some((c) => cityKey(c) === cityKey(city))) return false;
  state.cities.push(city);
  saveState(state);
  renderCards(state);
  state.refresh();
  return true;
}

export function flashCard(city) {
  const card = clocksEl.querySelector(`.card[data-key="${CSS.escape(cityKey(city))}"]`);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.remove('flash');
  void card.offsetWidth; // restart the animation if it is already running
  card.classList.add('flash');
}

export function describeCity(state, city, now) {
  const { zone } = city;
  const offset = utcOffsetMinutes(zone, now);
  const diff = offset - utcOffsetMinutes(LOCAL_ZONE, now);
  const phase = PHASES[cityPhase(city, now.getTime())];
  return {
    time: now.toLocaleTimeString('ms-MY', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    }),
    lines: [
      now.toLocaleDateString('ms-MY', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }),
      `${formatUtcOffset(offset)} · ${diff === 0 ? 'sama dengan anda' : `${signedDuration(diff)} dari anda`}`,
      phase.name,
      state.cities.some((c) => cityKey(c) === cityKey(city)) ? 'Dalam senarai anda' : 'Klik untuk tambah',
    ],
  };
}
