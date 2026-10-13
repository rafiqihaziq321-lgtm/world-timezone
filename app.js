'use strict';

const STORAGE_KEY = 'world-timezone:v1';
const DEFAULT_STATE = {
  zones: ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'],
  hour24: true,
};

// Some browsers (e.g. Chromium) list legacy IANA names. Swap in the current
// names so users searching "Kolkata" or "Kyiv" find them.
const RENAMED_ZONES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
};

function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

const ALL_ZONES = Intl.supportedValuesOf('timeZone')
  .map((z) => (RENAMED_ZONES[z] && isValidZone(RENAMED_ZONES[z]) ? RENAMED_ZONES[z] : z));
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const clocksEl = document.getElementById('clocks');
const formEl = document.getElementById('add-form');
const inputEl = document.getElementById('zone-input');
const listEl = document.getElementById('zone-list');
const errorEl = document.getElementById('form-error');
const format24El = document.getElementById('format24');

// "America/Argentina/Buenos_Aires" -> "Buenos Aires"
function cityName(zone) {
  return zone.split('/').pop().replace(/_/g, ' ');
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('localStorage tidak tersedia; guna tetapan lalai.', err);
    return { ...DEFAULT_STATE };
  }
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw);
    return {
      zones: Array.isArray(parsed.zones) ? parsed.zones.filter(isValidZone) : DEFAULT_STATE.zones,
      hour24: typeof parsed.hour24 === 'boolean' ? parsed.hour24 : DEFAULT_STATE.hour24,
    };
  } catch (err) {
    console.warn('Data tersimpan rosak; guna tetapan lalai.', err);
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Gagal simpan tetapan; perubahan tidak akan kekal selepas reload.', err);
  }
}

// Offset of `zone` from UTC in minutes at instant `date`, derived from the
// zone's wall-clock time so DST is handled by Intl rather than by us.
function utcOffsetMinutes(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function formatDiff(minutes) {
  if (minutes === 0) return 'Sama dengan waktu anda';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}j${m ? ` ${m}m` : ''} dari waktu anda`;
}

function hourIn(zone, date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

function renderCards(state) {
  clocksEl.replaceChildren();
  if (state.zones.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Tiada bandar. Tambah satu di atas.';
    clocksEl.append(p);
    return;
  }
  for (const zone of state.zones) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.zone = zone;
    card.innerHTML = `
      <div class="city"></div>
      <div class="time"></div>
      <div class="meta date"></div>
      <div class="meta diff"></div>
      <button class="remove" type="button" aria-label="Buang">×</button>`;
    card.classList.toggle('on-globe', GLOBE_CITIES.some((c) => c.zone === zone));
    card.querySelector('.city').textContent = cityName(zone);
    card.querySelector('.remove').addEventListener('click', () => {
      state.zones = state.zones.filter((z) => z !== zone);
      saveState(state);
      renderCards(state);
      tick(state);
    });
    clocksEl.append(card);
  }
}

function tick(state) {
  const now = new Date();
  const localOffset = utcOffsetMinutes(LOCAL_ZONE, now);
  for (const card of clocksEl.querySelectorAll('.card')) {
    const zone = card.dataset.zone;
    const hour = hourIn(zone, now);
    const isDay = hour >= 6 && hour < 18;
    card.querySelector('.time').textContent = `${isDay ? '☀️' : '🌙'} ` + now.toLocaleTimeString('ms-MY', {
      timeZone: zone,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    });
    card.querySelector('.date').textContent = now.toLocaleDateString('ms-MY', {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    card.querySelector('.diff').textContent = formatDiff(utcOffsetMinutes(zone, now) - localOffset);
  }
}

// Returns false when the zone is already listed.
function addZone(state, zone) {
  if (state.zones.includes(zone)) return false;
  state.zones.push(zone);
  saveState(state);
  renderCards(state);
  tick(state);
  return true;
}

function flashCard(zone) {
  const card = clocksEl.querySelector(`.card[data-zone="${CSS.escape(zone)}"]`);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.remove('flash');
  void card.offsetWidth; // restart the animation if it is already running
  card.classList.add('flash');
}

function init() {
  const state = loadState();

  const globe = createGlobe(document.getElementById('globe'), {
    onCityClick(zone) {
      addZone(state, zone);
      flashCard(zone);
    },
    isSelected: (zone) => state.zones.includes(zone),
    isHour24: () => state.hour24,
  });

  clocksEl.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card && !e.target.closest('.remove')) globe.focusZone(card.dataset.zone);
  });

  for (const zone of ALL_ZONES) {
    const opt = document.createElement('option');
    opt.value = zone;
    opt.label = cityName(zone);
    listEl.append(opt);
  }

  format24El.checked = state.hour24;
  format24El.addEventListener('change', () => {
    state.hour24 = format24El.checked;
    saveState(state);
    tick(state);
  });

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = inputEl.value.trim();
    // Accept either the exact IANA id or a city name typed by the user.
    const zone = (query.includes('/') && isValidZone(query) ? query : undefined)
      ?? ALL_ZONES.find((z) => cityName(z).toLowerCase() === query.toLowerCase());
    if (!zone) {
      errorEl.textContent = `Zon waktu "${query}" tidak dijumpai.`;
      errorEl.hidden = false;
      return;
    }
    if (!addZone(state, zone)) {
      errorEl.textContent = `${cityName(zone)} sudah ada dalam senarai.`;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    inputEl.value = '';
  });

  renderCards(state);
  tick(state);
  setInterval(() => tick(state), 1000);
}

init();
