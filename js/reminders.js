// Prayer-time reminders: a notification when a prayer time passes while the
// page is open. Without a server nothing can wake a closed page, so this is
// a convenience, not a guarantee, and the page says so.

import { MALAYSIA_STATES } from '../malaysia-data.js';
import { PRAYERS, PRAYER_TIMES, prayerFor } from './local-panel.js';
import { stateCity } from './places.js';
import { saveState } from './storage.js';
import { formatClock } from './time.js';
import { el } from './util.js';

const box = document.getElementById('prayer-reminder');

function supported() {
  return 'Notification' in window;
}

// Android Chrome only shows notifications through the service worker.
async function notify(title, options) {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration) return registration.showNotification(title, options);
  return new Notification(title, options);
}

export function setupReminders(state) {
  const status = el('p', 'local-status');
  status.setAttribute('role', 'status');
  if (!supported()) {
    box.replaceChildren(el('p', 'local-status', 'Pelayar ini tidak menyokong notifikasi, jadi peringatan waktu solat tidak tersedia.'));
    return;
  }
  const pick = el('label', 'reminder-pick', 'Negeri ');
  const select = el('select');
  for (const s of MALAYSIA_STATES) select.append(new Option(`${s.state} (${s.capital})`, s.state));
  pick.append(select);
  const toggle = el('button', 'btn secondary');
  toggle.type = 'button';
  const note = el('p', 'reminder-note',
    'Peringatan hanya berfungsi semasa Jam Dunia terbuka; tab di latar belakang boleh lewat sehingga seminit, dan telefon yang tidur mungkin tidak berbunyi. '
    + 'Untuk peringatan yang dijamin, guna app azan. Di iPhone, pasang Jam Dunia ke skrin utama dahulu.');

  const show = (message = '') => {
    const on = state.reminder !== null && Notification.permission === 'granted';
    select.value = state.reminder?.state ?? 'W.P. Kuala Lumpur';
    toggle.textContent = on ? '🔕 Matikan peringatan' : '🔔 Ingatkan saya';
    toggle.setAttribute('aria-pressed', String(on));
    const capital = MALAYSIA_STATES.find((s) => s.state === select.value).capital;
    status.textContent = message || (on ? `Peringatan aktif untuk waktu solat di ${capital}.` : '');
  };

  toggle.addEventListener('click', async () => {
    if (state.reminder !== null && Notification.permission === 'granted') {
      state.reminder = null;
      saveState(state);
      show();
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      show('Notifikasi disekat. Benarkan notifikasi untuk laman ini dalam tetapan pelayar, kemudian cuba lagi.');
      return;
    }
    state.reminder = { state: select.value };
    state.reminderSince = Date.now(); // only prayer times from now on
    saveState(state);
    show();
    state.refresh();
  });
  select.addEventListener('change', () => {
    if (state.reminder !== null) {
      state.reminder = { state: select.value };
      saveState(state);
    }
    show();
  });

  box.replaceChildren(el('h3', '', '🔔 Peringatan waktu solat'), pick, toggle, status, note);
  show();
}

// Called every tick: notifies once for the latest prayer time that passed
// since the previous call (several at once, after a sleeping tab, become one).
export function checkReminders(state, nowMs) {
  if (state.reminder === null || !supported() || Notification.permission !== 'granted') return;
  const since = state.reminderSince ?? nowMs;
  state.reminderSince = nowMs;
  const place = MALAYSIA_STATES.find((s) => s.state === state.reminder.state);
  const { today } = prayerFor(state, stateCity(place), new Date(nowMs));
  if (!today) return;
  const field = PRAYERS.filter((f) => today[f] && today[f] * 1000 > since && today[f] * 1000 <= nowMs).at(-1);
  if (!field) return;
  const label = PRAYER_TIMES.find(([f]) => f === field)[1];
  notify(`Waktu ${label} di ${place.capital}`, {
    body: `${formatClock(state, place.zone, today[field] * 1000)} · waktu JAKIM`,
    tag: `solat-${field}`,
    icon: 'icons/icon-192.png',
  }).catch((err) => {
    console.warn('Jam Dunia: notifikasi waktu solat tidak dapat dipaparkan.', err);
  });
}
