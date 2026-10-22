// The meeting planner and its working-hours settings.

import { cityKey } from '../globe.js';
import { saveState } from './storage.js';
import { HOUR_MS, LOCAL_ZONE, formatUtcOffset, hourLabel, minuteOfDay, minuteText, utcOffsetMinutes, weekdayOf } from './time.js';
import { el } from './util.js';

export const plannerSummaryEl = document.getElementById('planner-summary');
export const plannerTableEl = document.getElementById('planner-table');
export const WEEKDAYS = [[1, 'Isnin', 'Isn'], [2, 'Selasa', 'Sel'], [3, 'Rabu', 'Rab'], [4, 'Khamis', 'Kha'], [5, 'Jumaat', 'Jum'], [6, 'Sabtu', 'Sab'], [0, 'Ahad', 'Ahd']];
export const SLEEP_START_MIN = 22 * 60;
export const SLEEP_END_MIN = 7 * 60;

// An hour starting at `startMin` by a city's clock, on a working day or not.
export function slotCategory(startMin, work, isWeekend) {
  if (!isWeekend && startMin >= work.start && startMin + 60 <= work.end) return 'work';
  if (startMin >= SLEEP_START_MIN || startMin < SLEEP_END_MIN) return 'sleep';
  return isWeekend ? 'weekend' : 'off';
}

// 24 one-hour slots across the viewer's local day. Rebuilt only when its
// inputs change, since tick() calls this every second.
export function renderPlanner(state, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const currentSlot = Math.min(23, Math.floor((now.getTime() - dayStart) / HOUR_MS));
  const key = JSON.stringify([state.cities.map(cityKey), dayStart, currentSlot, state.hour24, state.work]);
  if (plannerTableEl.dataset.key === key) return;
  plannerTableEl.dataset.key = key;
  plannerTableEl.replaceChildren();

  if (state.cities.length === 0) {
    plannerSummaryEl.textContent = 'Tambah bandar untuk merancang mesyuarat.';
    return;
  }

  const slots = Array.from({ length: 24 }, (_, i) => dayStart + i * HOUR_MS);
  const categories = state.cities.map(({ zone }) => slots.map((ms) => (
    slotCategory(minuteOfDay(zone, ms), state.work, state.work.weekend.includes(weekdayOf(zone, ms))))));
  const allWork = slots.map((_, i) => categories.every((row) => row[i] === 'work'));

  const head = plannerTableEl.createTHead().insertRow();
  const corner = document.createElement('th');
  corner.scope = 'row';
  corner.textContent = 'Waktu anda';
  head.append(corner);
  slots.forEach((ms, i) => {
    const th = document.createElement('th');
    th.className = [allWork[i] && 'all-work', i === currentSlot && 'current'].filter(Boolean).join(' ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.slot = ms;
    btn.textContent = hourLabel(minuteOfDay(LOCAL_ZONE, ms), state.hour24);
    btn.setAttribute('aria-label', `Lihat masa ${new Date(ms).toLocaleTimeString('ms-MY', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })} waktu anda`);
    th.append(btn);
    head.append(th);
  });

  const body = plannerTableEl.createTBody();
  state.cities.forEach(({ name, zone }, r) => {
    const row = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = name;
    const utc = document.createElement('small');
    utc.textContent = formatUtcOffset(utcOffsetMinutes(zone, now));
    th.append(utc);
    row.append(th);
    slots.forEach((ms, i) => {
      const td = row.insertCell();
      td.className = [categories[r][i], i === currentSlot && 'current'].filter(Boolean).join(' ');
      td.dataset.slot = ms;
      td.textContent = hourLabel(minuteOfDay(zone, ms), state.hour24);
    });
  });

  const ranges = [];
  allWork.forEach((ok, i) => {
    if (!ok) return;
    const last = ranges[ranges.length - 1];
    if (last && last.end === i) last.end = i + 1;
    else ranges.push({ start: i, end: i + 1 });
  });
  const fmt = (ms) => new Date(ms).toLocaleTimeString('ms-MY', {
    hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
  plannerSummaryEl.textContent = ranges.length
    ? `Waktu sesuai untuk semua (waktu anda): ${ranges.map((g) => `${fmt(slots[g.start])}–${fmt(dayStart + g.end * HOUR_MS)}`).join(', ')}`
    : `Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini${
      categories.some((row) => row.includes('weekend')) ? ' (ada bandar sedang hujung minggu)' : ''}.`;
}

// The working-hours form above the planner. Built once; changing it saves
// and redraws the planner.
export function setupWorkSettings(state) {
  const startEl = document.getElementById('work-start');
  const endEl = document.getElementById('work-end');
  const daysEl = document.getElementById('weekend-days');
  for (let m = 0; m <= 24 * 60; m += 30) {
    if (m < 24 * 60) startEl.append(new Option(minuteText(m), String(m)));
    if (m > 0) endEl.append(new Option(minuteText(m), String(m)));
  }
  for (const [day, name, short] of WEEKDAYS) {
    const label = el('label', 'day-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.value = String(day);
    box.setAttribute('aria-label', name);
    label.append(box, el('span', '', short));
    daysEl.append(label);
  }

  const show = () => {
    startEl.value = String(state.work.start);
    endEl.value = String(state.work.end);
    for (const box of daysEl.querySelectorAll('input')) box.checked = state.work.weekend.includes(Number(box.value));
    document.getElementById('work-legend').textContent = `Waktu kerja (${minuteText(state.work.start)}–${minuteText(state.work.end)})`;
    const names = WEEKDAYS.filter(([d]) => state.work.weekend.includes(d)).map(([, n]) => n);
    document.getElementById('weekend-legend').textContent = `Hujung minggu${names.length ? ` (${names.join(', ')})` : ': tiada'}`;
  };
  // A range always keeps at least an hour; moving one end past the other drags it along.
  const update = (changed) => {
    let start = Number(startEl.value);
    let end = Number(endEl.value);
    if (start >= end) {
      if (changed === 'start') end = Math.min(start + 60, 24 * 60);
      else start = Math.max(end - 60, 0);
    }
    const weekend = [...daysEl.querySelectorAll('input:checked')].map((box) => Number(box.value));
    state.work = { start, end, weekend };
    saveState(state);
    show();
    state.refresh();
  };
  startEl.addEventListener('change', () => update('start'));
  endEl.addEventListener('change', () => update('end'));
  daysEl.addEventListener('change', () => update('days'));
  show();
}
