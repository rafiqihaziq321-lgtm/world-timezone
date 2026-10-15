'use strict';

const STORAGE_KEY = 'world-timezone:v1';
const DEFAULT_ZONES = ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];

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
const heroPlaceEl = document.getElementById('hero-place');
const heroTimeEl = document.getElementById('hero-time');
const heroDateEl = document.getElementById('hero-date');

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

// A city in the user's list. lat/lon are null when unknown; such a city
// still gets a card, just no dot on the globe.
function makeCity(name, zone, lat = null, lon = null) {
  return { name, zone, lat, lon };
}

// The city a bare IANA zone stands for, e.g. "Asia/Tokyo" -> Tokyo, with its
// position when it is one of the globe's built-in cities.
function cityForZone(zone) {
  const known = GLOBE_CITIES.find((c) => c.zone === zone);
  return makeCity(cityName(zone), zone, known?.lat ?? null, known?.lon ?? null);
}

function defaultState() {
  return { cities: DEFAULT_ZONES.map(cityForZone), hour24: true, theme: null }; // theme null = follow the system
}

function parseStoredCity(raw) {
  if (!raw || typeof raw.name !== 'string' || typeof raw.zone !== 'string' || !isValidZone(raw.zone)) return null;
  const coord = (n) => (Number.isFinite(n) ? n : null);
  return makeCity(raw.name, raw.zone, coord(raw.lat), coord(raw.lon));
}

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('localStorage tidak tersedia; guna tetapan lalai.', err);
    return defaultState();
  }
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const defaults = defaultState();
    let cities = defaults.cities;
    if (Array.isArray(parsed.cities)) {
      cities = parsed.cities.map(parseStoredCity).filter(Boolean);
    } else if (Array.isArray(parsed.zones)) {
      // Lists saved before cities existed held zone ids only.
      cities = parsed.zones.filter((z) => typeof z === 'string' && isValidZone(z)).map(cityForZone);
    }
    return {
      cities,
      hour24: typeof parsed.hour24 === 'boolean' ? parsed.hour24 : defaults.hour24,
      theme: ['light', 'dark'].includes(parsed.theme) ? parsed.theme : defaults.theme,
    };
  } catch (err) {
    console.warn('Data tersimpan rosak; guna tetapan lalai.', err);
    return defaultState();
  }
}

// While viewing a shared link (state.shared), the visible list is the sender's,
// so the viewer's own list (state.savedCities) is what gets stored.
function saveState(state) {
  const cities = (state.shared ? state.savedCities : state.cities)
    .map(({ name, zone, lat, lon }) => ({ name, zone, lat, lon }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cities, hour24: state.hour24, theme: state.theme }));
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

function createCard(state, city) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.zone = city.zone;
  card.dataset.key = cityKey(city);
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
    <button class="remove" type="button"></button>`;
  card.querySelector('.city').textContent = city.name;
  const remove = card.querySelector('.remove');
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Buang ${city.name}`);
  remove.addEventListener('click', () => {
    card.classList.add('leaving');
    card.addEventListener('animationend', () => {
      state.cities = state.cities.filter((c) => cityKey(c) !== cityKey(city));
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
  const existing = new Map([...clocksEl.querySelectorAll('.card')].map((c) => [c.dataset.key, c]));
  clocksEl.replaceChildren();
  if (state.cities.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Tiada bandar. Tambah satu di atas atau klik bandar pada glob.';
    clocksEl.append(p);
    return;
  }
  let entering = 0;
  for (const city of state.cities) {
    let card = existing.get(cityKey(city));
    if (!card) {
      card = createCard(state, city);
      card.classList.add('enter');
      card.style.setProperty('--i', entering++);
    }
    clocksEl.append(card);
  }
}

// The hero's large clock shows the viewer's own zone at the displayed instant.
function renderHero(state, now) {
  const city = cityName(LOCAL_ZONE);
  heroPlaceEl.textContent = state.viewTime === null
    ? `Di ${city}, sekarang pukul`
    : `Di ${city}, masa yang dipilih ialah`;
  const parts = new Intl.DateTimeFormat('ms-MY', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: state.hour24 ? 'h23' : 'h12',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const seconds = document.createElement('span');
  seconds.className = 'hero-seconds';
  seconds.textContent = `:${get('second')}`;
  const nodes = [`${get('hour')}:${get('minute')}`, seconds];
  if (!state.hour24) {
    const period = document.createElement('span');
    period.className = 'hero-period';
    period.textContent = ` ${get('dayPeriod')}`;
    nodes.push(period);
  }
  heroTimeEl.replaceChildren(...nodes);
  heroTimeEl.dataset.phase = dayPhase(minuteOfDay(LOCAL_ZONE, now.getTime()));
  heroDateEl.textContent = now.toLocaleDateString('ms-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function tick(state) {
  const now = displayDate(state);
  renderHero(state, now);
  const localOffset = utcOffsetMinutes(LOCAL_ZONE, now);
  for (const card of clocksEl.querySelectorAll('.card')) {
    const zone = card.dataset.zone;
    const city = state.cities.find((c) => cityKey(c) === card.dataset.key);
    // Positions can arrive after the card does (shared links look them up).
    card.classList.toggle('on-globe', Boolean(city && city.lat !== null));
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
  const key = JSON.stringify([state.cities.map(cityKey), dayStart, currentSlot, state.hour24]);
  if (plannerTableEl.dataset.key === key) return;
  plannerTableEl.dataset.key = key;
  plannerTableEl.replaceChildren();

  if (state.cities.length === 0) {
    plannerSummaryEl.textContent = 'Tambah bandar untuk merancang mesyuarat.';
    return;
  }

  const slots = Array.from({ length: 24 }, (_, i) => dayStart + i * HOUR_MS);
  const categories = state.cities.map(({ zone }) => slots.map((ms) => slotCategory(minuteOfDay(zone, ms))));
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

// Returns false when the city is already listed.
function addCity(state, city) {
  if (state.cities.some((c) => cityKey(c) === cityKey(city))) return false;
  state.cities.push(city);
  saveState(state);
  renderCards(state);
  tick(state);
  return true;
}

function flashCard(city) {
  const card = clocksEl.querySelector(`.card[data-key="${CSS.escape(cityKey(city))}"]`);
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

function describeCity(state, city, now) {
  const { zone } = city;
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
      state.cities.some((c) => cityKey(c) === cityKey(city)) ? '✓ Dalam senarai anda' : 'Klik untuk tambah',
    ],
  };
}

// A city in a share link: its zone, plus "~Name" when the name is not simply
// the zone's own city ("Asia/Tokyo", "Asia/Kuala_Lumpur~Johor Bahru").
function shareToken(city) {
  const token = city.name === cityName(city.zone) ? city.zone : `${city.zone}~${city.name}`;
  // Keep "/" readable; everything else is percent-encoded.
  return encodeURIComponent(token).replace(/%2F/g, '/');
}

function parseShareToken(token) {
  const [zone, ...rest] = token.trim().split('~');
  if (zone === '' || !isValidZone(zone)) return null;
  const name = rest.join('~').trim();
  if (!name) return cityForZone(zone);
  const known = GLOBE_CITIES.find((c) => c.zone === zone && c.name === name);
  return makeCity(name, zone, known?.lat ?? null, known?.lon ?? null);
}

// Reads `?bandar=<token>,<token>&masa=<ISO instant>`. Unknown zones and
// repeats are dropped; a missing or unusable part comes back as null.
function readShareParams() {
  const params = new URLSearchParams(window.location.search);
  const cities = [];
  for (const city of (params.get('bandar') ?? '').split(',').map(parseShareToken)) {
    if (city && !cities.some((c) => cityKey(c) === cityKey(city))) cities.push(city);
  }
  const time = Date.parse(params.get('masa') ?? '');
  return {
    cities: cities.length ? cities : null,
    time: Number.isFinite(time) ? time : null,
  };
}

function buildShareUrl(state) {
  let query = `?bandar=${state.cities.map(shareToken).join(',')}`;
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

// "São Paulo " -> "sao paulo", so searches ignore case and accents.
function normalizeName(text) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

// Finds "Name" or "Name, Country" in the city list (rows are most populous
// first, so a bare "George Town" is the one in Penang).
function findCity(rows, query) {
  const [name, country] = query.split(/,(?=[^,]*$)/).map(normalizeName);
  const row = rows.find((r) => normalizeName(r[0]) === name && (country === undefined || normalizeName(r[1]) === country));
  return row ? makeCity(row[0], row[2], row[3], row[4]) : null;
}

// vendor/cities.js is ~400 KB, so it is only fetched once someone searches
// (or opens a shared link that needs city positions).
function createCityListLoader() {
  let pending = null;
  return function loadCityList() {
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/cities.js';
        script.onload = () => resolve(window.WORLD_CITIES);
        script.onerror = () => {
          pending = null; // allow a retry on the next search
          script.remove();
          reject(new Error('vendor/cities.js gagal dimuat'));
        };
        document.head.append(script);
      });
    }
    return pending;
  };
}

function init() {
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker gagal didaftarkan; mod luar talian tidak tersedia.', err);
    });
  }

  const loadCityList = createCityListLoader();
  const saved = loadState();
  const shared = readShareParams();
  const state = {
    ...saved,
    cities: shared.cities ?? saved.cities,
    savedCities: [...saved.cities],
    shared: shared.cities !== null,
    viewTime: null,
  };
  shareBannerEl.hidden = !state.shared;

  const globe = createGlobe(document.getElementById('globe'), {
    onCityClick(city) {
      const listed = makeCity(city.name, city.zone, city.lat, city.lon);
      addCity(state, listed);
      flashCard(listed);
    },
    getSelectedCities: () => state.cities,
    isHour24: () => state.hour24,
    getNow: () => displayDate(state),
    describeCity: (city, now) => describeCity(state, city, now),
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
    if (!card || e.target.closest('.remove')) return;
    const city = state.cities.find((c) => cityKey(c) === card.dataset.key);
    if (city) globe.focusCity(city);
  });

  function showCityListError(err) {
    console.warn(err);
    errorEl.textContent = 'Senarai bandar gagal dimuat. Anda masih boleh menaip zon waktu, cth. Asia/Tokyo.';
    errorEl.hidden = false;
  }

  inputEl.addEventListener('focus', () => {
    if (listEl.childElementCount) return;
    loadCityList().then((rows) => {
      if (listEl.childElementCount) return;
      listEl.append(...rows.map(([name, country]) => {
        const opt = document.createElement('option');
        opt.value = `${name}, ${country}`;
        return opt;
      }));
    }, showCityListError);
  });

  format24El.checked = state.hour24;
  format24El.addEventListener('change', () => {
    state.hour24 = format24El.checked;
    saveState(state);
    setViewTime(state, state.viewTime); // refresh the time label's 12/24h format
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = inputEl.value.trim();
    // An exact IANA id, then the city list, then the zone names the browser knows.
    let city = query.includes('/') && isValidZone(query) ? cityForZone(query) : null;
    if (!city) {
      try {
        city = findCity(await loadCityList(), query);
      } catch (err) {
        showCityListError(err);
      }
    }
    if (!city) {
      const zone = ALL_ZONES.find((z) => normalizeName(cityName(z)) === normalizeName(query));
      if (zone) city = cityForZone(zone);
    }
    if (!city) {
      errorEl.textContent = `Bandar atau zon waktu "${query}" tidak dijumpai.`;
      errorEl.hidden = false;
      return;
    }
    if (!addCity(state, city)) {
      errorEl.textContent = `${city.name} sudah ada dalam senarai.`;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    inputEl.value = '';
  });

  shareEl.addEventListener('click', () => copyShareLink(state));
  shareSaveEl.addEventListener('click', () => {
    state.savedCities = [...state.cities];
    state.shared = false;
    saveState(state);
    shareBannerEl.hidden = true;
    clearShareParams();
  });
  shareExitEl.addEventListener('click', () => {
    stopPlay();
    state.cities = [...state.savedCities];
    state.shared = false;
    shareBannerEl.hidden = true;
    clearShareParams();
    renderCards(state);
    setViewTime(state, null);
  });

  // Cities named in a shared link only carry name and zone; look up where they
  // are so they get globe dots too.
  if (state.shared && state.cities.some((c) => c.lat === null)) {
    loadCityList().then((rows) => {
      for (const city of state.cities.filter((c) => c.lat === null)) {
        const row = rows.find((r) => r[0] === city.name && r[2] === city.zone);
        if (row) [city.lat, city.lon] = [row[3], row[4]];
      }
      tick(state);
    }, (err) => console.warn('Kedudukan bandar dalam pautan tidak dapat dicari.', err));
  }

  renderCards(state);
  if (shared.time !== null) setViewTime(state, shared.time);
  else tick(state);
  setInterval(() => tick(state), 1000);
}

init();
