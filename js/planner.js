// The meeting planner and its working-hours settings.

import { cityKey } from '../globe.js';
import { googleCalendarUrl, icsEvent } from './calendar.js';
import { icon } from './icons.js';
import { saveState } from './storage.js';
import { HOUR_MS, LOCAL_ZONE, formatClock, formatUtcOffset, hourLabel, minuteOfDay, minuteText, utcOffsetMinutes, weekdayOf } from './time.js';
import { el, renderKeyed } from './util.js';

export const plannerSummaryEl = document.getElementById('planner-summary');
export const plannerTableEl = document.getElementById('planner-table');
const plannerDateEl = document.getElementById('planner-date');
const plannerPickEl = document.getElementById('planner-pick');
const plannerScrollEl = document.querySelector('.planner-scroll');

const pad = (n) => String(n).padStart(2, '0');

// The viewer's calendar day of `ms` as YYYY-MM-DD, and its local midnight.
function isoDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayStartOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function dayName(ms) {
  return new Date(ms).toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

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
// state.plannerDay (YYYY-MM-DD) is the day planned; null follows the
// displayed time. state.plannerPick is the slot chosen for the calendar.
export function renderPlanner(state, now) {
  const day = state.plannerDay ?? isoDay(now.getTime());
  const dayStart = dayStartOf(day);
  const currentSlot = day === isoDay(now.getTime()) ? Math.min(23, Math.floor((now.getTime() - dayStart) / HOUR_MS)) : -1;
  if (document.activeElement !== plannerDateEl) plannerDateEl.value = day;
  renderPick(state);
  const key = JSON.stringify([state.cities.map(cityKey), dayStart, currentSlot, state.hour24, state.work, state.plannerPick]);
  if (plannerTableEl.dataset.key === key) {
    revealHours(state, day, dayStart, currentSlot);
    return;
  }
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
    th.className = [allWork[i] && 'all-work', i === currentSlot && 'current', ms === state.plannerPick && 'picked'].filter(Boolean).join(' ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.slot = ms;
    btn.setAttribute('aria-pressed', String(ms === state.plannerPick));
    btn.textContent = hourLabel(minuteOfDay(LOCAL_ZONE, ms), state.hour24);
    btn.setAttribute('aria-label', `Pilih ${new Date(ms).toLocaleTimeString('ms-MY', {
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
    utc.textContent = formatUtcOffset(utcOffsetMinutes(zone, new Date(dayStart + 12 * HOUR_MS))); // that day's offset (DST)
    th.append(utc);
    row.append(th);
    slots.forEach((ms, i) => {
      const td = row.insertCell();
      td.className = [categories[r][i], i === currentSlot && 'current', ms === state.plannerPick && 'picked'].filter(Boolean).join(' ');
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
  if (ranges.length) {
    plannerSummaryEl.textContent = `Waktu sesuai untuk semua (waktu anda): ${ranges.map((g) => `${fmt(slots[g.start])}–${fmt(dayStart + g.end * HOUR_MS)}`).join(', ')}`;
  } else {
    plannerSummaryEl.replaceChildren(`Tiada jam yang berada dalam waktu kerja untuk semua bandar pada ${day === isoDay(Date.now()) ? 'hari ini' : dayName(dayStart)}${
      categories.some((row) => row.includes('weekend')) ? ' (ada bandar sedang hujung minggu)' : ''}.`, ...bestHour(state, slots, categories, fmt));
  }
  revealHours(state, day, dayStart, currentSlot);
  updateScrollHint(); // the table may have grown or shrunk
}

const NOT_WORK = { off: 'luar waktu kerja', sleep: 'waktu tidur', weekend: 'hujung minggu' };

// With no hour that suits everyone, the closest: most cities at work, then
// fewest asleep, earliest first. Nothing is offered when nobody is at work.
function bestHour(state, slots, categories, fmt) {
  const score = (i) => {
    const column = categories.map((row) => row[i]);
    return { work: column.filter((c) => c === 'work').length, sleep: column.filter((c) => c === 'sleep').length };
  };
  const better = (a, b) => a.work > b.work || (a.work === b.work && a.sleep < b.sleep);
  let best = 0;
  for (let i = 1; i < slots.length; i += 1) if (better(score(i), score(best))) best = i;
  const top = score(best);
  if (top.work === 0) return [];
  let end = best + 1;
  while (end < slots.length && !better(score(best), score(end)) && !better(score(end), score(best))) end += 1;
  const others = state.cities.flatMap(({ name, zone }, r) => (categories[r][best] === 'work' ? []
    : [`${name} ${formatClock(state, zone, slots[best])} (${NOT_WORK[categories[r][best]]})`]));
  const pick = el('button', 'btn secondary', `Pilih ${fmt(slots[best])}`);
  pick.type = 'button';
  pick.addEventListener('click', () => {
    state.plannerPick = slots[best];
    state.refresh();
  });
  const text = `Paling sesuai: ${fmt(slots[best])}–${fmt(slots[best] + (end - best) * HOUR_MS)} waktu anda, ${top.work} daripada ${state.cities.length} bandar dalam waktu kerja; ${others.join(', ')}.`;
  return [el('span', 'planner-best', text), pick];
}

// On a narrow screen the table scrolls sideways and starts at midnight.
// Bring the hour that matters into view (the chosen one, now, or the start
// of work), once for each day shown so later redraws never move the reader.
function revealHours(state, day, dayStart, currentSlot) {
  const head = plannerTableEl.tHead?.rows[0];
  // Checked in this order so the every-second redraw reads no layout.
  if (plannerScrollEl.dataset.day === day || !head || plannerScrollEl.clientWidth === 0) return;
  plannerScrollEl.dataset.day = day;
  const picked = state.plannerPick === null ? -1 : Math.round((state.plannerPick - dayStart) / HOUR_MS);
  const index = picked >= 0 && picked < 24 ? picked : currentSlot >= 0 ? currentSlot : Math.floor(state.work.start / 60);
  // The hour before it starts where the first hour does (just right of the
  // sticky city names, whose own offset moves with the scroll), for context.
  plannerScrollEl.scrollLeft = index === 0 ? 0 : head.cells[index].offsetLeft - head.cells[1].offsetLeft;
  updateScrollHint();
}

// A shadow on the right edge while more hours lie beyond it.
function updateScrollHint() {
  const more = plannerScrollEl.scrollLeft + plannerScrollEl.clientWidth < plannerScrollEl.scrollWidth - 1;
  plannerScrollEl.parentElement.classList.toggle('more-right', more);
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
    document.getElementById('work-summary').textContent = `Waktu kerja ${minuteText(state.work.start)}–${minuteText(state.work.end)} · Hujung minggu: ${names.length ? names.join(', ') : 'tiada'}`;
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

// The chosen hour as a calendar event: each city's local time goes in the
// description, so invitees see their own.
function meeting(state) {
  const start = state.plannerPick;
  const end = start + HOUR_MS;
  const lines = state.cities.map(({ name, zone }) => {
    const fmt = (ms) => new Date(ms).toLocaleTimeString('ms-MY', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12' });
    const weekday = new Date(start).toLocaleDateString('ms-MY', { timeZone: zone, weekday: 'long' });
    return `${name}: ${fmt(start)}–${fmt(end)} (${weekday})`;
  });
  return { start, end, title: 'Mesyuarat', description: `${lines.join('\n')}\n\nDirancang dengan Jam Dunia`, now: Date.now() };
}

function renderPick(state) {
  const key = [state.plannerPick, state.hour24, state.cities.map(cityKey).join(',')].join('|');
  plannerPickEl.hidden = state.plannerPick === null || state.cities.length === 0;
  renderKeyed(plannerPickEl, key, () => {
    if (plannerPickEl.hidden) return [];
    const event = meeting(state);
    const fmt = (ms) => new Date(ms).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12' });
    const ics = el('button', 'btn');
    ics.append(icon('calendar'), 'Muat turun fail kalendar (.ics)');
    ics.type = 'button';
    ics.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([icsEvent(meeting(state))], { type: 'text/calendar;charset=utf-8' }));
      const link = el('a');
      link.href = url;
      link.download = `mesyuarat-${isoDay(event.start)}-${pad(new Date(event.start).getHours())}${pad(new Date(event.start).getMinutes())}.ics`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const view = el('button', 'btn secondary');
    view.append(icon('clock'), 'Lihat masa ini');
    view.type = 'button';
    view.dataset.viewTime = String(event.start); // handled in app.js, which owns the time slider
    const google = el('a', 'btn secondary', 'Buka di Google Calendar');
    google.href = googleCalendarUrl(event);
    google.target = '_blank';
    google.rel = 'noopener';
    return [el('p', 'planner-pick-when', `Dipilih: ${dayName(event.start)}, ${fmt(event.start)}–${fmt(event.end)} waktu anda`), ics, google, view];
  });
}

// The day controls: a date field, the days either side, and back to today.
export function setupPlannerDay(state) {
  const go = (iso) => {
    state.plannerDay = iso;
    state.refresh();
  };
  plannerDateEl.addEventListener('change', () => {
    if (plannerDateEl.value) go(plannerDateEl.value);
  });
  const shift = (days) => {
    const start = dayStartOf(plannerDateEl.value || isoDay(Date.now()));
    const d = new Date(start);
    d.setDate(d.getDate() + days);
    go(isoDay(d.getTime()));
  };
  document.getElementById('planner-prev').addEventListener('click', () => shift(-1));
  document.getElementById('planner-next').addEventListener('click', () => shift(1));
  document.getElementById('planner-today').addEventListener('click', () => go(null));
  plannerScrollEl.addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
}
