'use strict';

const STORAGE_KEY = 'world-timezone:v1';
const DEFAULT_STATE = {
  zones: ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'],
  hour24: true,
  theme: null, // null = follow the system setting, else 'light' | 'dark'
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
const timeSliderEl = document.getElementById('time-slider');
const timeLabelEl = document.getElementById('time-label');
const timeResetEl = document.getElementById('time-reset');
const plannerSummaryEl = document.getElementById('planner-summary');
const plannerTableEl = document.getElementById('planner-table');
const playEl = document.getElementById('time-play');
const themeEl = document.getElementById('theme-toggle');
const zoomInEl = document.getElementById('zoom-in');
const zoomOutEl = document.getElementById('zoom-out');
const shareEl = document.getElementById('share');
const shareStatusEl = document.getElementById('share-status');
const shareBannerEl = document.getElementById('share-banner');
const shareSaveEl = document.getElementById('share-save');
const shareExitEl = document.getElementById('share-exit');

const MINUTE_MS = 60 * 1000;
const QUARTER_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const WORK_START_MIN = 9 * 60;
const WORK_END_MIN = 17 * 60;
const SLEEP_START_MIN = 22 * 60;
const SLEEP_END_MIN = 7 * 60;

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
      theme: ['light', 'dark'].includes(parsed.theme) ? parsed.theme : DEFAULT_STATE.theme,
    };
  } catch (err) {
    console.warn('Data tersimpan rosak; guna tetapan lalai.', err);
    return { ...DEFAULT_STATE };
  }
}

// While viewing a shared link (state.shared), the visible list is the sender's,
// so the viewer's own list (state.savedZones) is what gets stored.
function saveState(state) {
  const zones = state.shared ? state.savedZones : state.zones;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones, hour24: state.hour24, theme: state.theme }));
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

// 195 -> "+3j 15m", -120 -> "−2j"
function signedDuration(minutes) {
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}j${m ? ` ${m}m` : ''}`;
}

// 480 -> "UTC+8", 330 -> "UTC+5:30", -240 -> "UTC−4"
function formatUtcOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const m = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function formatDiff(minutes) {
  if (minutes === 0) return 'Sama dengan waktu anda';
  return `${signedDuration(minutes)} dari waktu anda`;
}

// The instant every clock shows: live now, or the time picked with the slider
// or planner (state.viewTime, epoch ms).
function displayDate(state) {
  return state.viewTime === null ? new Date() : new Date(state.viewTime);
}

function floorToQuarter(ms) {
  return Math.floor(ms / QUARTER_MS) * QUARTER_MS;
}

function minuteOfDay(zone, ms) {
  const minutes = Math.floor(ms / MINUTE_MS) + utcOffsetMinutes(zone, new Date(ms));
  return ((minutes % 1440) + 1440) % 1440;
}

function slotCategory(startMin) {
  if (startMin >= WORK_START_MIN && startMin + 60 <= WORK_END_MIN) return 'work';
  if (startMin >= SLEEP_START_MIN || startMin < SLEEP_END_MIN) return 'sleep';
  return 'off';
}

function hourLabel(minutes, hour24) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const shown = hour24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  return m ? `${shown}:${String(m).padStart(2, '0')}` : shown;
}

// Part of the day by the city's own clock; drives the card background and icon.
const PHASES = {
  dawn: { icon: '🌅', name: 'Fajar' },
  day: { icon: '☀️', name: 'Siang' },
  dusk: { icon: '🌇', name: 'Senja' },
  night: { icon: '🌙', name: 'Malam' },
};

function dayPhase(minutes) {
  if (minutes >= 5 * 60 && minutes < 7 * 60) return 'dawn';
  if (minutes >= 7 * 60 && minutes < 17 * 60) return 'day';
  if (minutes >= 17 * 60 && minutes < 19 * 60) return 'dusk';
  return 'night';
}

const ANALOG_TICKS = Array.from({ length: 12 }, (_, i) => {
  const major = i % 3 === 0;
  return `<line class="tick" x1="50" y1="${major ? 8 : 10}" x2="50" y2="${major ? 16 : 14}" transform="rotate(${i * 30} 50 50)"/>`;
}).join('');

function createCard(state, zone) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.zone = zone;
  card.innerHTML = `
    <div class="card-head">
      <span class="phase" aria-hidden="true"></span>
      <span class="city"></span>
      <span class="utc"></span>
    </div>
    <div class="card-body">
      <div>
        <div class="time"></div>
        <div class="meta date"></div>
        <div class="meta diff"></div>
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
    <button class="remove" type="button" aria-label="Buang ${cityName(zone)}">×</button>`;
  card.classList.toggle('on-globe', GLOBE_CITIES.some((c) => c.zone === zone));
  card.querySelector('.city').textContent = cityName(zone);
  card.querySelector('.remove').addEventListener('click', () => {
    card.classList.add('leaving');
    card.addEventListener('animationend', () => {
      state.zones = state.zones.filter((z) => z !== zone);
      saveState(state);
      renderCards(state);
      tick(state);
    }, { once: true });
  });
  card.addEventListener('animationend', (e) => {
    if (e.animationName === 'card-in') card.classList.remove('enter');
  });
  return card;
}

// Keeps existing card elements so only added cards animate in.
function renderCards(state) {
  const existing = new Map([...clocksEl.querySelectorAll('.card')].map((c) => [c.dataset.zone, c]));
  clocksEl.replaceChildren();
  if (state.zones.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Tiada bandar. Tambah satu di atas atau klik bandar pada glob.';
    clocksEl.append(p);
    return;
  }
  let entering = 0;
  for (const zone of state.zones) {
    let card = existing.get(zone);
    if (!card) {
      card = createCard(state, zone);
      card.classList.add('enter');
      card.style.setProperty('--i', entering++);
    }
    clocksEl.append(card);
  }
}

function tick(state) {
  const now = displayDate(state);
  const localOffset = utcOffsetMinutes(LOCAL_ZONE, now);
  for (const card of clocksEl.querySelectorAll('.card')) {
    const zone = card.dataset.zone;
    const offset = utcOffsetMinutes(zone, now);
    const minutes = minuteOfDay(zone, now.getTime());
    const seconds = now.getUTCSeconds();
    const phase = dayPhase(minutes);
    card.dataset.phase = phase;
    card.querySelector('.phase').textContent = PHASES[phase].icon;
    card.querySelector('.utc').textContent = formatUtcOffset(offset);
    card.querySelector('.time').textContent = now.toLocaleTimeString('ms-MY', {
      timeZone: zone,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    });
    card.querySelector('.date').textContent = now.toLocaleDateString('ms-MY', {
      timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    card.querySelector('.diff').textContent = formatDiff(offset - localOffset);
    card.querySelector('.hand.hour').setAttribute('transform', `rotate(${(minutes % 720) / 2} 50 50)`);
    card.querySelector('.hand.minute').setAttribute('transform', `rotate(${(minutes % 60) * 6 + seconds / 10} 50 50)`);
    card.querySelector('.hand.second').setAttribute('transform', `rotate(${seconds * 6} 50 50)`);
  }
  renderPlanner(state, now);
}

// 24 one-hour slots across the viewer's local day. Rebuilt only when its
// inputs change, since tick() calls this every second.
function renderPlanner(state, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const currentSlot = Math.min(23, Math.floor((now.getTime() - dayStart) / HOUR_MS));
  const key = JSON.stringify([state.zones, dayStart, currentSlot, state.hour24]);
  if (plannerTableEl.dataset.key === key) return;
  plannerTableEl.dataset.key = key;
  plannerTableEl.replaceChildren();

  if (state.zones.length === 0) {
    plannerSummaryEl.textContent = 'Tambah bandar untuk merancang mesyuarat.';
    return;
  }

  const slots = Array.from({ length: 24 }, (_, i) => dayStart + i * HOUR_MS);
  const categories = state.zones.map((zone) => slots.map((ms) => slotCategory(minuteOfDay(zone, ms))));
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
  state.zones.forEach((zone, r) => {
    const row = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = cityName(zone);
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
    : 'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini.';
}

// Switches every clock to `ms` (epoch ms), or back to live time when null.
function setViewTime(state, ms) {
  state.viewTime = ms;
  const shifted = ms !== null;
  document.body.classList.toggle('time-shifted', shifted);
  timeResetEl.hidden = !shifted;
  if (shifted) {
    const offsetMin = Math.round((ms - floorToQuarter(Date.now())) / MINUTE_MS);
    timeSliderEl.value = String(Math.round(offsetMin / 15));
    const when = new Date(ms).toLocaleString('ms-MY', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    });
    timeLabelEl.textContent = `${offsetMin === 0 ? 'Sekarang' : `${signedDuration(offsetMin)} dari sekarang`} · ${when} waktu anda`;
  } else {
    timeSliderEl.value = '0';
    timeLabelEl.textContent = 'Sekarang';
  }
  tick(state);
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
  if (card.classList.contains('enter')) return; // its entrance animation is feedback enough
  card.classList.remove('flash');
  void card.offsetWidth; // restart the animation if it is already running
  card.classList.add('flash');
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(state) {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  const dark = (state.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
  themeEl.textContent = dark ? '☀️' : '🌙';
  themeEl.setAttribute('aria-label', dark ? 'Tukar ke tema cerah' : 'Tukar ke tema gelap');
}

function describeCity(state, zone, now) {
  const offset = utcOffsetMinutes(zone, now);
  const diff = offset - utcOffsetMinutes(LOCAL_ZONE, now);
  const phase = PHASES[dayPhase(minuteOfDay(zone, now.getTime()))];
  return {
    time: now.toLocaleTimeString('ms-MY', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: state.hour24 ? 'h23' : 'h12',
    }),
    lines: [
      now.toLocaleDateString('ms-MY', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }),
      `${formatUtcOffset(offset)} · ${diff === 0 ? 'sama dengan anda' : `${signedDuration(diff)} dari anda`}`,
      `${phase.icon} ${phase.name}`,
      state.zones.includes(zone) ? '✓ Dalam senarai anda' : 'Klik untuk tambah',
    ],
  };
}

// Reads `?bandar=Zone/A,Zone/B&masa=<ISO instant>`. Unknown zones are dropped;
// a missing or unusable part comes back as null.
function readShareParams() {
  const params = new URLSearchParams(window.location.search);
  const zoneList = (params.get('bandar') ?? '').split(',').map((z) => z.trim()).filter(isValidZone);
  const time = Date.parse(params.get('masa') ?? '');
  return {
    zones: zoneList.length ? [...new Set(zoneList)] : null,
    time: Number.isFinite(time) ? time : null,
  };
}

function buildShareUrl(state) {
  // Keep "/" and "," readable; everything else is percent-encoded.
  const zones = state.zones.map((z) => encodeURIComponent(z).replace(/%2F/g, '/')).join(',');
  let query = `?bandar=${zones}`;
  if (state.viewTime !== null) query += `&masa=${new Date(state.viewTime).toISOString().replace('.000Z', 'Z')}`;
  return `${window.location.origin}${window.location.pathname}${query}`;
}

function clearShareParams() {
  window.history.replaceState(null, '', window.location.pathname);
}

async function copyShareLink(state) {
  const url = buildShareUrl(state);
  shareStatusEl.hidden = false;
  try {
    await navigator.clipboard.writeText(url);
    shareStatusEl.textContent = 'Pautan disalin ke clipboard.';
  } catch (err) {
    // Clipboard can be blocked (permissions, insecure context): let the user copy by hand.
    console.info('Clipboard tidak tersedia; papar pautan untuk disalin manual.', err);
    shareStatusEl.textContent = 'Salin pautan ini: ';
    const field = document.createElement('input');
    field.readOnly = true;
    field.value = url;
    field.setAttribute('aria-label', 'Pautan kongsi');
    shareStatusEl.append(field);
    field.select();
  }
}

function init() {
  const saved = loadState();
  const shared = readShareParams();
  const state = {
    ...saved,
    zones: shared.zones ?? saved.zones,
    savedZones: [...saved.zones],
    shared: shared.zones !== null,
    viewTime: null,
  };
  shareBannerEl.hidden = !state.shared;

  const globe = createGlobe(document.getElementById('globe'), {
    onCityClick(zone) {
      addZone(state, zone);
      flashCard(zone);
    },
    getSelectedZones: () => state.zones,
    isHour24: () => state.hour24,
    getNow: () => displayDate(state),
    describeCity: (zone, now) => describeCity(state, zone, now),
    offsetBetween(from, to, now) {
      const diff = utcOffsetMinutes(to, now) - utcOffsetMinutes(from, now);
      return diff === 0 ? 'Sama' : signedDuration(diff);
    },
  });
  zoomInEl.addEventListener('click', () => globe.zoomBy(1.4));
  zoomOutEl.addEventListener('click', () => globe.zoomBy(1 / 1.4));

  applyTheme(state);
  systemDark.addEventListener('change', () => applyTheme(state));
  themeEl.addEventListener('click', () => {
    const dark = (state.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark';
    state.theme = dark ? 'light' : 'dark';
    saveState(state);
    applyTheme(state);
  });

  // ▶ sweeps the displayed time forward at PLAY_MIN_PER_SEC, wrapping from
  // +24h back to −24h, until paused or the user picks a time another way.
  const PLAY_MIN_PER_SEC = 72; // a full day in 20 seconds
  let playFrame = null;
  let playLast = 0;
  function stopPlay() {
    if (playFrame !== null) cancelAnimationFrame(playFrame);
    playFrame = null;
    playEl.textContent = '▶';
    playEl.setAttribute('aria-label', 'Main 24 jam');
    playEl.classList.remove('playing');
  }
  function playStep(t) {
    const elapsed = t - playLast;
    playLast = t;
    const base = floorToQuarter(Date.now());
    let next = (state.viewTime ?? Date.now()) + (elapsed / 1000) * PLAY_MIN_PER_SEC * MINUTE_MS;
    if (next > base + 24 * HOUR_MS) next = base - 24 * HOUR_MS;
    setViewTime(state, next);
    playFrame = requestAnimationFrame(playStep);
  }
  playEl.addEventListener('click', () => {
    if (playFrame !== null) {
      stopPlay();
      return;
    }
    playEl.textContent = '⏸';
    playEl.setAttribute('aria-label', 'Jeda');
    playEl.classList.add('playing');
    playLast = performance.now();
    playFrame = requestAnimationFrame(playStep);
  });

  timeSliderEl.addEventListener('input', () => {
    stopPlay();
    const steps = Number(timeSliderEl.value);
    setViewTime(state, steps === 0 ? null : floorToQuarter(Date.now()) + steps * QUARTER_MS);
  });
  timeResetEl.addEventListener('click', () => {
    stopPlay();
    setViewTime(state, null);
  });

  plannerTableEl.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-slot]');
    if (!cell) return;
    stopPlay();
    setViewTime(state, Number(cell.dataset.slot));
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
    setViewTime(state, state.viewTime); // refresh the time label's 12/24h format
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

  shareEl.addEventListener('click', () => copyShareLink(state));
  shareSaveEl.addEventListener('click', () => {
    state.savedZones = [...state.zones];
    state.shared = false;
    saveState(state);
    shareBannerEl.hidden = true;
    clearShareParams();
  });
  shareExitEl.addEventListener('click', () => {
    stopPlay();
    state.zones = [...state.savedZones];
    state.shared = false;
    shareBannerEl.hidden = true;
    clearShareParams();
    renderCards(state);
    setViewTime(state, null);
  });

  renderCards(state);
  if (shared.time !== null) setViewTime(state, shared.time);
  else tick(state);
  setInterval(() => tick(state), 1000);
}

init();
