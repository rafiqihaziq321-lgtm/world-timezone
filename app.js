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
  if (isMalaysian(city)) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'local-toggle';
    toggle.textContent = 'Solat & cuaca';
    toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'local-panel';
    panel.hidden = true;
    toggle.addEventListener('click', () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      if (opening) tick(state); // fetches start only once the panel is opened
    });
    card.append(toggle, panel);
  }
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
    const panel = card.querySelector('.local-panel');
    if (panel && !panel.hidden && city) renderLocalPanel(state, panel, city, now);
  }
  renderPlanner(state, now);
  if (state.tab === 'malaysia') renderMalaysia(state, now);
  if (state.tab === 'bandar-malaysia') renderCities(state, now);
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

// ---------- Malaysian cities: prayer times, weather, air quality ----------

const MALAYSIA_ZONES = ['Asia/Kuala_Lumpur', 'Asia/Kuching'];
const PRAYER_API = 'https://api.waktusolat.app/v2/solat/gps'; // JAKIM times; zone found from GPS
const WEATHER_API = 'https://api.data.gov.my/weather/forecast'; // MET Malaysia 7-day forecast
const AIR_QUALITY_URL = 'https://eqms.doe.gov.my/'; // JAS APIMS: no public API, so we link to it
const PRAYER_TIMES = [['fajr', 'Subuh'], ['syuruk', 'Syuruk'], ['dhuhr', 'Zohor'], ['asr', 'Asar'], ['maghrib', 'Maghrib'], ['isha', 'Isyak']];
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']; // syuruk is sunrise, not a prayer

function isMalaysian(city) {
  return MALAYSIA_ZONES.includes(city.zone);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} (${url})`);
  return response.json();
}

// Fetches are remembered for the page's lifetime, so ticking the clock or
// reopening a panel never repeats a request. A failed one can be retried.
function createLocalData(onSettled) {
  const entries = new Map();
  return {
    // `source` is a URL to fetch as JSON, or a function returning a promise.
    get(key, source) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { status: 'loading', data: null, error: null };
        entries.set(key, entry);
        const load = typeof source === 'function' ? source : () => fetchJson(source);
        load().then(
          (data) => Object.assign(entry, { status: 'ok', data }),
          (err) => {
            Object.assign(entry, { status: 'error', error: err });
            console.info('Jam Dunia: data luar gagal dimuat.', err);
          },
        ).finally(onSettled);
      }
      return entry;
    },
    retry(key) {
      entries.delete(key);
      onSettled();
    },
  };
}

// The year, month, day and ISO date of `now` on the city's own calendar.
function cityDate(zone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), iso: `${get('year')}-${get('month')}-${get('day')}` };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function retryButton(state, key) {
  const button = el('button', 'local-retry', 'Cuba lagi');
  button.type = 'button';
  button.addEventListener('click', () => state.localData.retry(key));
  return button;
}

function prayerSection(state, city, entry, key, now, day) {
  const section = el('section', 'local-block');
  const heading = el('h4', '', 'Waktu solat');
  section.append(heading);
  if (!entry) {
    section.append(el('p', '', 'Kedudukan bandar ini tidak diketahui, jadi zon waktu solatnya tidak dapat ditentukan.'));
    return section;
  }
  if (entry.status === 'loading') {
    section.append(el('p', 'local-status', 'Memuatkan waktu solat…'));
    return section;
  }
  if (entry.status === 'error') {
    section.append(el('p', 'local-status', 'Waktu solat tidak dapat dimuat.'), retryButton(state, key));
    return section;
  }
  const today = Array.isArray(entry.data.prayers) ? entry.data.prayers.find((p) => p.day === day) : undefined;
  if (!today) {
    section.append(el('p', 'local-status', 'Tiada waktu solat untuk tarikh ini.'));
    return section;
  }
  heading.append(' ', el('small', '', `zon ${entry.data.zone}`));
  const nowSec = now.getTime() / 1000;
  const next = PRAYERS.find((field) => today[field] && today[field] > nowSec);
  const fmt = (ts) => new Date(ts * 1000).toLocaleTimeString('ms-MY', {
    timeZone: city.zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
  const list = el('ul', 'prayer-times');
  for (const [field, label] of PRAYER_TIMES) {
    const item = el('li', field === next ? 'next' : '');
    item.append(el('span', '', label), el('strong', '', today[field] ? fmt(today[field]) : '—'));
    list.append(item);
  }
  section.append(list);
  if (next) {
    const label = PRAYER_TIMES.find(([field]) => field === next)[1];
    const minutes = Math.ceil((today[next] - nowSec) / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const wait = [h && `${h}j`, m && `${m}m`].filter(Boolean).join(' ');
    section.append(el('p', 'next-prayer', `Seterusnya: ${label} dalam ${wait}`));
  } else {
    section.append(el('p', 'next-prayer', 'Semua waktu solat hari ini telah berlalu.'));
  }
  return section;
}

function weatherSection(state, city, entry, key, iso) {
  const section = el('section', 'local-block');
  const heading = el('h4', '', 'Cuaca');
  section.append(heading);
  if (entry.status === 'loading') {
    section.append(el('p', 'local-status', 'Memuatkan ramalan cuaca…'));
    return section;
  }
  if (entry.status === 'error') {
    section.append(el('p', 'local-status', 'Ramalan cuaca tidak dapat dimuat.'), retryButton(state, key));
    return section;
  }
  const records = Array.isArray(entry.data) ? entry.data : [];
  // The search matches substrings, so prefer the location named exactly like the city.
  const exact = records.filter((r) => normalizeName(r.location?.location_name ?? '') === normalizeName(city.name));
  const record = (exact.length ? exact : records).find((r) => r.date === iso);
  if (!records.length) {
    section.append(el('p', 'local-status', `Tiada ramalan MET Malaysia untuk ${city.name}.`));
    return section;
  }
  if (!record) {
    section.append(el('p', 'local-status', 'Tiada ramalan untuk tarikh ini.'));
    return section;
  }
  heading.append(' ', el('small', '', `${record.min_temp}–${record.max_temp}°C`));
  const list = el('dl', 'forecast');
  for (const [label, text] of [['Pagi', record.morning_forecast], ['Petang', record.afternoon_forecast], ['Malam', record.night_forecast]]) {
    list.append(el('dt', '', label), el('dd', '', text ?? '—'));
  }
  section.append(list);
  if (!exact.length) section.append(el('p', 'local-status', `Ramalan untuk ${record.location?.location_name}.`));
  return section;
}

// `air` is a state capital's estimate from stateAirQuality(), or null where
// we have none (cities outside the Bandar tab), which leaves only the link.
function airQualitySection(state, air = null) {
  const section = el('section', 'local-block');
  section.append(el('h4', '', 'Kualiti udara'));
  if (air) {
    if (air.entry.status === 'loading') {
      section.append(el('p', 'local-status', 'Memuatkan anggaran kualiti udara…'));
    } else if (air.entry.status === 'error') {
      section.append(el('p', 'local-status', 'Anggaran kualiti udara tidak dapat dimuat.'), retryButton(state, air.key));
    } else if (!air.estimate) {
      section.append(el('p', 'local-status', 'Data model tidak mencukupi untuk anggaran.'));
    } else {
      const { index, band, pm25, pm10 } = air.estimate;
      const reading = el('p', `aqi-reading aqi-${band.id}`);
      reading.append(el('strong', '', String(index)), ` ${band.label}`);
      section.append(reading, el('p', 'local-status',
        `Anggaran: PM2.5 ${pm25} µg/m³, PM10 ${pm10} µg/m³ (purata 24 jam, model CAMS). Bukan IPU rasmi JAS.`));
    }
  }
  const link = el('a', 'local-link', 'Semak IPU rasmi (JAS)');
  link.href = AIR_QUALITY_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  section.append(link);
  if (!air) section.append(el('p', 'local-status', 'Bacaan dikemas kini setiap jam daripada stesen Jabatan Alam Sekitar.'));
  return section;
}

// The month of JAKIM times for a city (null without a position), shared by
// every view that shows the same city.
function prayerFor(state, city, now) {
  const { year, month, day } = cityDate(city.zone, now);
  const key = `solat|${city.lat},${city.lon}|${year}-${month}`;
  const entry = city.lat === null ? null
    : state.localData.get(key, `${PRAYER_API}/${city.lat}/${city.lon}?year=${year}&month=${month}`);
  const today = entry?.status === 'ok' && Array.isArray(entry.data.prayers)
    ? entry.data.prayers.find((p) => p.day === day) ?? null
    : null;
  return { key, entry, day, today };
}

function nextPrayer(today, now) {
  if (!today) return null;
  return PRAYERS.find((field) => today[field] && today[field] > now.getTime() / 1000) ?? null;
}

function formatClock(state, zone, ms) {
  return new Date(ms).toLocaleTimeString('ms-MY', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12',
  });
}

// Rebuilt only when the data, the displayed minute or the 12/24h setting
// change, so buttons and links keep keyboard focus between ticks.
function renderLocalPanel(state, panel, city, now, air = null) {
  const { iso } = cityDate(city.zone, now);
  const { key: prayerKey, entry: prayer, day } = prayerFor(state, city, now);
  const weatherKey = `cuaca|${city.name}`;
  const weather = state.localData.get(weatherKey, `${WEATHER_API}?contains=${encodeURIComponent(city.name)}@location__location_name&limit=50`);
  const renderKey = [prayerKey, prayer?.status, weather.status, air?.key, air?.entry.status, Math.floor(now.getTime() / MINUTE_MS), state.hour24].join('|');
  if (panel.dataset.key === renderKey) return;
  panel.dataset.key = renderKey;
  panel.replaceChildren(
    prayerSection(state, city, prayer, prayerKey, now, day),
    weatherSection(state, city, weather, weatherKey, iso),
    airQualitySection(state, air),
    el('p', 'local-source', `Waktu solat: JAKIM melalui waktusolat.app. Cuaca: MET Malaysia melalui data.gov.my.${
      air ? ' Kualiti udara: Copernicus CAMS melalui Open-Meteo (CC BY 4.0).' : ''}`),
  );
}

// ---------- Tabs: Jam dunia / Malaysia / Bandar Malaysia ----------

const TABS = ['dunia', 'malaysia', 'bandar-malaysia'];
const WARNING_API = 'https://api.data.gov.my/weather/warning';
const QUAKE_API = 'https://api.data.gov.my/weather/warning/earthquake';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

// Shows the tab named by the hash, or the tab containing the element it
// names (so #perancang still works), defaulting to the world clock.
function showTab(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  let tab = TABS.includes(id) ? id : null;
  if (!tab && id) tab = document.getElementById(id)?.closest('.tab-panel')?.id ?? null;
  tab = tab ?? 'dunia';
  for (const name of TABS) document.getElementById(name).hidden = name !== tab;
  for (const link of document.querySelectorAll('.nav-links a')) {
    if (link.getAttribute('href') === `#${tab}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  return tab;
}

// MET Malaysia dates and times carry no zone; they are Malaysian time.
function parseMyt(text) {
  if (!text) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}+08:00`);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weatherIcon(text = '') {
  const t = text.toLowerCase();
  if (/ribut|petir/.test(t)) return '⛈️';
  if (/hujan/.test(t) && !/tiada hujan/.test(t)) return '🌧️';
  if (/jerebu/.test(t)) return '🌫️';
  if (/mendung|berawan/.test(t)) return '☁️';
  return '🌤️';
}

// MET warnings name every affected district after "kawasan berikut:", which
// can run to hundreds of words; the lead clause says what and when.
function warningSummary(text, max = 160) {
  const colon = text.search(/(?<!\d):(?!\d)/); // not the colon in "6:00 petang"
  let lead = (colon > 0 ? text.slice(0, colon) : text.split(/(?<=\.)\s/)[0]).trim();
  if (lead.length > max) {
    const space = lead.lastIndexOf(' ', max - 1);
    lead = `${lead.slice(0, space > 0 ? space : max - 1)}…`;
  }
  return lead;
}

function loadErrorText(entry, what) {
  return /\b429\b/.test(entry.error?.message ?? '')
    ? `Had permintaan data.gov.my dicapai (4 seminit). Cuba lagi sebentar lagi.`
    : `${what} tidak dapat dimuat.`;
}

// One request for every state's forecast, today and the next two days; the
// Malaysia and Bandar tabs both read it (the API allows 4 requests a minute).
function stateForecasts(state, now) {
  const { iso } = cityDate('Asia/Kuala_Lumpur', now);
  const url = `${WEATHER_API}?contains=St@location__location_id&date_start=${iso}@date&date_end=${addDaysIso(iso, 2)}@date&limit=100`;
  return { iso, key: `cuaca-negeri|${iso}`, entry: state.localData.get(`cuaca-negeri|${iso}`, url) };
}

// MET names its state locations its own way ("WP Kuala Lumpur", "Penang"...).
function stateNameKey(name) {
  const aliases = { penang: 'pulau pinang', malacca: 'melaka' };
  const key = normalizeName(name).replace(/^(w\.?\s?p\.?|wilayah persekutuan)\s+/, '').trim();
  return aliases[key] ?? key;
}

function forecastForState(rows, stateName, iso) {
  const want = stateNameKey(stateName);
  return rows.find((r) => r.date === iso && stateNameKey(r.location?.location_name ?? '') === want) ?? null;
}

function statusLine(state, entry, key, what) {
  if (entry.status === 'loading') return el('p', 'local-status', `Memuatkan ${what.toLowerCase()}…`);
  const box = el('div', 'load-error');
  box.append(el('p', 'local-status', loadErrorText(entry, what)), retryButton(state, key));
  return box;
}

function renderKeyed(node, key, build) {
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.replaceChildren(...build());
}

function renderMalaysia(state, now) {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  document.getElementById('my-today').textContent = `${now.toLocaleDateString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })}, ${formatClock(state, 'Asia/Kuala_Lumpur', now.getTime())} waktu Malaysia (UTC+8)`;

  // Warnings still in force.
  const warnKey = 'amaran';
  const warnings = state.localData.get(warnKey, `${WARNING_API}?sort=-warning_issue__issued&limit=20`);
  // MET reissues warnings unchanged, so show each title and text once.
  const seen = new Set();
  const active = (warnings.status === 'ok' && Array.isArray(warnings.data) ? warnings.data : [])
    .filter((w) => !(parseMyt(w.valid_to) < now.getTime()))
    .filter((w) => {
      const id = `${w.warning_issue?.title_bm || w.heading_bm}|${w.text_bm}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  // Keyed on what is shown, not the minute, so an opened "Baca penuh" stays open.
  const warnRenderKey = [warnings.status, state.hour24, ...active.map((w) => `${w.warning_issue?.issued}|${w.valid_to}|${w.text_bm}`)].join('|');
  renderKeyed(document.getElementById('my-warnings'), warnRenderKey, () => {
    const heading = el('h3', '', 'Amaran cuaca');
    if (warnings.status !== 'ok') return [heading, statusLine(state, warnings, warnKey, 'Amaran cuaca')];
    if (!active.length) return [heading, el('p', 'local-status', 'Tiada amaran cuaca aktif.')];
    return [heading, ...active.map((w) => {
      const item = el('article', 'alert');
      const text = w.text_bm || '';
      const summary = warningSummary(text);
      item.append(el('h4', '', w.warning_issue?.title_bm || w.heading_bm || 'Amaran'), el('p', '', summary));
      if (summary !== text) {
        const more = el('details', 'alert-more');
        more.append(el('summary', '', 'Baca penuh'), el('p', '', text));
        item.append(more);
      }
      const until = parseMyt(w.valid_to);
      if (Number.isFinite(until)) {
        item.append(el('p', 'local-status', `Sah hingga ${new Date(until).toLocaleString('ms-MY', {
          timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          hourCycle: state.hour24 ? 'h23' : 'h12',
        })}`));
      }
      return item;
    })];
  });

  // The latest earthquakes MET reports.
  const quakeKey = 'gempa';
  const quakes = state.localData.get(quakeKey, `${QUAKE_API}?sort=-utcdatetime&limit=5`);
  renderKeyed(document.getElementById('my-quakes'), `${quakes.status}|${state.hour24}`, () => {
    const heading = el('h3', '', 'Gempa bumi terkini');
    if (quakes.status !== 'ok') return [heading, statusLine(state, quakes, quakeKey, 'Data gempa bumi')];
    const list = (Array.isArray(quakes.data) ? quakes.data : []).filter((q) => q.visible !== false).slice(0, 3);
    if (!list.length) return [heading, el('p', 'local-status', 'Tiada laporan gempa bumi.')];
    return [heading, ...list.map((q) => {
      const item = el('article', 'alert quake');
      const when = parseMyt(q.localdatetime);
      item.append(
        el('h4', '', `Magnitud ${q.magdefault ?? '?'}: ${q.location || q.location_original || ''}`),
        el('p', '', q.nbm_distancemas || ''),
      );
      if (Number.isFinite(when)) {
        item.append(el('p', 'local-status', new Date(when).toLocaleString('ms-MY', {
          timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          hourCycle: state.hour24 ? 'h23' : 'h12',
        })));
      }
      return item;
    })];
  });

  // Every state's forecast for today.
  const forecasts = stateForecasts(state, now);
  renderKeyed(document.getElementById('my-weather'), `${forecasts.key}|${forecasts.entry.status}`, () => {
    if (forecasts.entry.status !== 'ok') return [statusLine(state, forecasts.entry, forecasts.key, 'Ramalan cuaca')];
    const rows = (Array.isArray(forecasts.entry.data) ? forecasts.entry.data : [])
      .filter((r) => r.date === forecasts.iso)
      .sort((a, b) => (a.location?.location_name ?? '').localeCompare(b.location?.location_name ?? ''));
    if (!rows.length) return [el('p', 'local-status', 'Tiada ramalan negeri untuk hari ini.')];
    return rows.map((r) => {
      const tile = el('article', 'weather-tile');
      const summary = r.summary_forecast || r.afternoon_forecast || '';
      tile.append(
        el('span', 'weather-icon', weatherIcon(summary)),
        el('h3', '', r.location?.location_name ?? ''),
        el('p', '', summary),
        el('p', 'weather-temp', `${r.min_temp}–${r.max_temp}°C`),
      );
      return tile;
    });
  });

  // JAKIM times for each capital.
  const prayers = MALAYSIA_STATES.map((s) => ({ s, ...prayerFor(state, makeCity(s.capital, s.zone, s.lat, s.lon), now) }));
  const prayerKey = prayers.map((p) => `${p.key}:${p.entry.status}`).join('|');
  renderKeyed(document.getElementById('my-prayers'), `${prayerKey}|${minute}|${state.hour24}`, () => {
    const head = el('thead');
    const headRow = head.insertRow();
    for (const label of ['Negeri', ...PRAYER_TIMES.map(([, l]) => l)]) headRow.append(el('th', '', label));
    const body = el('tbody');
    for (const p of prayers) {
      const row = body.insertRow();
      const name = el('th', '', p.s.state);
      name.scope = 'row';
      name.append(el('small', '', p.s.capital));
      row.append(name);
      if (p.entry.status !== 'ok' || !p.today) {
        const cell = row.insertCell();
        cell.colSpan = PRAYER_TIMES.length;
        if (p.entry.status === 'error') cell.append(el('span', 'local-status', 'Gagal dimuat. '), retryButton(state, p.key));
        else cell.append(el('span', 'local-status', p.entry.status === 'loading' ? 'Memuatkan…' : 'Tiada data untuk tarikh ini.'));
        continue;
      }
      const next = nextPrayer(p.today, now);
      for (const [field] of PRAYER_TIMES) {
        const cell = row.insertCell();
        cell.textContent = p.today[field] ? formatClock(state, p.s.zone, p.today[field] * 1000) : '—';
        if (field === next) cell.className = 'next';
      }
    }
    return [head, body];
  });
}

function renderFacts() {
  const table = document.getElementById('my-facts');
  const head = el('thead');
  const headRow = head.insertRow();
  for (const label of ['Negeri', 'Ibu negeri', 'Penduduk (juta)', 'Keluasan (km²)']) headRow.append(el('th', '', label));
  const body = el('tbody');
  const largest = Math.max(...MALAYSIA_STATES.map((s) => s.population));
  for (const s of [...MALAYSIA_STATES].sort((a, b) => b.population - a.population)) {
    const row = body.insertRow();
    const name = el('th', '', s.state);
    name.scope = 'row';
    row.append(name, el('td', '', s.capital));
    const pop = row.insertCell();
    const bar = el('span', 'bar');
    bar.style.setProperty('--share', String(s.population / largest));
    pop.append(bar, el('span', '', s.population.toLocaleString('ms-MY', { minimumFractionDigits: 1 })));
    row.append(el('td', '', `≈ ${s.area.toLocaleString('ms-MY')}`));
  }
  const foot = el('tfoot');
  const total = foot.insertRow();
  const label = el('th', '', 'Malaysia');
  label.scope = 'row';
  total.append(label, el('td', '', ''), el('td', '', MALAYSIA_TOTAL.population.toLocaleString('ms-MY', { minimumFractionDigits: 1 })),
    el('td', '', `≈ ${MALAYSIA_TOTAL.area.toLocaleString('ms-MY')}`));
  table.replaceChildren(head, body, foot);
}

// Lead photos of each landmark's Wikipedia article, with author and licence
// from Wikimedia Commons: two batched requests for all 16 cities.
async function loadLandmarkPhotos() {
  const titles = MALAYSIA_STATES.map((s) => s.landmark);
  const base = `${WIKI_API}?action=query&format=json&formatversion=2&origin=*`;
  const pagesRes = await fetchJson(`${base}&redirects=1&prop=pageimages&piprop=thumbnail|name&pithumbsize=800&titles=${titles.map(encodeURIComponent).join('|')}`);
  // Follow the API's title normalisation and redirects back to our titles.
  const rename = new Map([...(pagesRes.query?.normalized ?? []), ...(pagesRes.query?.redirects ?? [])].map((r) => [r.from, r.to]));
  const finalTitle = (t) => {
    let title = t.replace(/_/g, ' ');
    for (let i = 0; i < 3 && rename.has(title); i += 1) title = rename.get(title);
    return title;
  };
  const pages = new Map((pagesRes.query?.pages ?? []).map((p) => [p.title, p]));
  const photos = new Map();
  for (const title of titles) {
    const page = pages.get(finalTitle(title));
    if (page?.thumbnail?.source && page.pageimage) {
      photos.set(title, { src: page.thumbnail.source, width: page.thumbnail.width, height: page.thumbnail.height, file: page.pageimage });
    }
  }
  if (!photos.size) return photos;

  try {
    const files = [...photos.values()].map((p) => `File:${p.file}`);
    const infoRes = await fetchJson(`${base}&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl&titles=${files.map(encodeURIComponent).join('|')}`);
    const byFile = new Map((infoRes.query?.pages ?? []).map((p) => [p.title.replace(/^File:/, '').replace(/ /g, '_'), p.imageinfo?.[0]?.extmetadata ?? {}]));
    for (const photo of photos.values()) {
      const meta = byFile.get(photo.file.replace(/ /g, '_')) ?? {};
      // Artist is HTML; keep only its text.
      photo.artist = new DOMParser().parseFromString(meta.Artist?.value ?? '', 'text/html').body.textContent.trim();
      photo.license = meta.LicenseShortName?.value ?? '';
    }
  } catch (err) {
    // Photos still show; the credit then links to Commons without the details.
    console.info('Jam Dunia: maklumat lesen foto tidak dapat dimuat.', err);
  }
  return photos;
}

function photoCredit(photo) {
  const credit = el('p', 'photo-credit');
  const parts = [photo.artist, photo.license].filter(Boolean).join(', ');
  credit.append(`Foto: ${parts ? `${parts}, ` : ''}`);
  const link = el('a', '', 'Wikimedia Commons');
  link.href = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(photo.file)}`;
  link.target = '_blank';
  link.rel = 'noopener';
  credit.append(link);
  return credit;
}

function photoElement(s, photo, sizes) {
  if (!photo) {
    const blank = el('div', 'photo-missing');
    blank.append(el('span', '', s.landmarkName));
    return blank;
  }
  const img = el('img');
  img.src = photo.src;
  img.alt = `${s.landmarkName}, ${s.capital}`;
  img.width = photo.width;
  img.height = photo.height;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.sizes = sizes;
  return img;
}

function stateCity(s) {
  return makeCity(s.capital, s.zone, s.lat, s.lon);
}

function renderCities(state, now) {
  const grid = document.getElementById('my-cities');
  const photos = state.localData.get('foto-landmark', loadLandmarkPhotos);
  const forecasts = stateForecasts(state, now);
  const air = stateAirQuality(state);
  const minute = Math.floor(now.getTime() / MINUTE_MS);

  if (!state.mapView) {
    state.mapView = { status: 'loading' };
    createMalaysiaMap(state).then((view) => {
      Object.assign(state.mapView, { status: 'ready' }, view);
      tick(state);
    }, (err) => {
      state.mapView.status = 'error';
      console.info('Jam Dunia: peta 3D tidak dapat dipaparkan.', err);
      setMapStatus('Peta 3D tidak dapat dipaparkan: pelayar ini mungkin tidak menyokong WebGL, atau fail peta gagal dimuat. Senarai bandar di bawah masih berfungsi.');
    });
  }
  if (state.mapView.status === 'ready') renderMapMarkers(state, state.mapView, now, photos, forecasts, air);

  if (!grid.childElementCount) {
    for (const s of MALAYSIA_STATES) {
      const card = el('article', 'city-card');
      card.dataset.state = s.state;
      const open = el('button', 'city-open');
      open.type = 'button';
      open.setAttribute('aria-label', `Butiran ${s.capital}, ${s.state}`);
      const info = el('div', 'city-info');
      info.append(el('h3', '', s.capital), el('p', 'city-state', s.state), el('p', 'city-landmark', s.landmarkName), el('p', 'city-now'));
      open.append(el('div', 'city-photo'), info);
      open.addEventListener('click', () => openCityDialog(state, s));
      card.append(open, el('div', 'city-credit'));
      grid.append(card);
    }
  }

  for (const card of grid.children) {
    const s = MALAYSIA_STATES.find((x) => x.state === card.dataset.state);
    renderKeyed(card.querySelector('.city-photo'), photos.status, () => {
      if (photos.status === 'loading') return [el('div', 'photo-missing photo-loading')];
      return [photoElement(s, photos.data?.get(s.landmark), '(max-width: 600px) 100vw, 400px')];
    });
    renderKeyed(card.querySelector('.city-credit'), photos.status, () => {
      const photo = photos.status === 'ok' ? photos.data.get(s.landmark) : null;
      return photo ? [photoCredit(photo)] : [];
    });

    const { entry, today } = prayerFor(state, stateCity(s), now);
    const forecast = forecasts.entry.status === 'ok' && Array.isArray(forecasts.entry.data)
      ? forecastForState(forecasts.entry.data, s.state, forecasts.iso) : null;
    const { estimate } = air.forState(s);
    renderKeyed(card.querySelector('.city-now'), `${entry.status}|${forecasts.entry.status}|${estimate?.index}|${minute}|${state.hour24}`, () => {
      const lines = [];
      if (forecast) {
        const summary = forecast.summary_forecast || forecast.afternoon_forecast || '';
        lines.push(el('span', '', `${weatherIcon(summary)} ${summary}, ${forecast.min_temp}–${forecast.max_temp}°C`));
      }
      const next = nextPrayer(today, now);
      if (next) {
        const label = PRAYER_TIMES.find(([f]) => f === next)[1];
        lines.push(el('span', '', `🕌 ${label} ${formatClock(state, s.zone, today[next] * 1000)}`));
      }
      if (estimate) {
        const aqi = el('span', 'city-aqi');
        aqi.append(el('span', `aqi-dot aqi-${estimate.band.id}`), `IPU anggaran ${estimate.index}, ${estimate.band.label}`);
        lines.push(aqi);
      }
      return lines;
    });
  }

  const dialog = document.getElementById('city-dialog');
  if (dialog.open && state.dialogState) {
    const s = state.dialogState;
    const panel = dialog.querySelector('.local-panel');
    if (panel) renderLocalPanel(state, panel, stateCity(s), now, air.forState(s));
    renderKeyed(dialog.querySelector('.dialog-photo'), photos.status, () => {
      const photo = photos.status === 'ok' ? photos.data.get(s.landmark) : null;
      return [photoElement(s, photo, '(max-width: 700px) 100vw, 640px'), ...(photo ? [photoCredit(photo)] : [])];
    });
  }
}

function openCityDialog(state, s) {
  const dialog = document.getElementById('city-dialog');
  state.dialogState = s;
  const title = el('h2', '', s.capital);
  title.id = 'city-dialog-title';
  const panel = el('div', 'local-panel');
  document.getElementById('city-dialog-body').replaceChildren(
    el('div', 'dialog-photo'),
    title,
    el('p', 'city-state', `${s.state}. ${s.landmarkName}`),
    panel,
  );
  dialog.showModal();
  tick(state);
}

// ---------- Estimated air quality (Open-Meteo, CAMS model) ----------

const AIR_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
// Malaysia's 24-hour ambient air standards (MAAQS 2020), µg/m³.
const PM25_STANDARD = 35;
const PM10_STANDARD = 100;
// The IPU's published bands.
const AIR_BANDS = [
  { max: 50, id: 'good', label: 'Baik' },
  { max: 100, id: 'moderate', label: 'Sederhana' },
  { max: 200, id: 'unhealthy', label: 'Tidak sihat' },
  { max: 300, id: 'very-unhealthy', label: 'Sangat tidak sihat' },
  { max: Infinity, id: 'hazardous', label: 'Berbahaya' },
];

// JAS does not publish the breakpoints it converts PM readings with, so this
// is an IPU-like estimate, not the IPU: 100 means the worse of PM2.5 and PM10
// is at its 24-hour standard, from modelled rather than measured levels.
// `hourly` is Open-Meteo's series with unix times; null if under 18 hours.
function estimateAirIndex(hourly, nowMs) {
  const from = nowMs / 1000 - 24 * 3600;
  const mean = (values) => {
    const recent = (hourly?.time ?? []).flatMap((t, i) => (t > from && t <= nowMs / 1000 && Number.isFinite(values?.[i]) ? [values[i]] : []));
    return recent.length >= 18 ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  };
  const pm25 = mean(hourly?.pm2_5);
  const pm10 = mean(hourly?.pm10);
  if (pm25 === null || pm10 === null) return null;
  const index = Math.round(Math.max((pm25 / PM25_STANDARD) * 100, (pm10 / PM10_STANDARD) * 100));
  return { index, band: AIR_BANDS.find((b) => index <= b.max), pm25: Math.round(pm25), pm10: Math.round(pm10) };
}

// One request for all 16 capitals, refreshed each hour; Open-Meteo returns
// a list in the order the coordinates were given.
function stateAirQuality(state) {
  const nowMs = Date.now();
  const key = `udara|${Math.floor(nowMs / HOUR_MS)}`;
  const coords = (field) => MALAYSIA_STATES.map((s) => s[field]).join(',');
  const entry = state.localData.get(key, `${AIR_API}?latitude=${coords('lat')}&longitude=${coords('lon')}&hourly=pm10,pm2_5&past_days=1&forecast_days=1&timeformat=unixtime`);
  return {
    key,
    entry,
    forState(s) {
      const rows = entry.status === 'ok' && Array.isArray(entry.data) ? entry.data : [];
      return { key, entry, estimate: estimateAirIndex(rows[MALAYSIA_STATES.indexOf(s)]?.hourly, nowMs) };
    },
  };
}

// ---------- 3D map of Malaysia (MapLibre, OpenFreeMap, AWS terrain) ----------

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_ATTRIBUTION = '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Rupa bumi: Mapzen, AWS</a>';
const MALAYSIA_BOUNDS = [[99.6, 0.85], [119.3, 7.4]];
const PENINSULA_BOUNDS = [[99.6, 1.2], [104.4, 6.75]]; // phones: Borneo is a swipe away
const MAP_PITCH = 35;
const LABEL_ZOOM = 6.5; // markers show their name and readings from here in
const MAP_LOCALE = {
  'NavigationControl.ZoomIn': 'Zum masuk',
  'NavigationControl.ZoomOut': 'Zum keluar',
  'NavigationControl.ResetBearing': 'Seret untuk memutar, klik untuk menghala ke utara',
  'FullscreenControl.Enter': 'Skrin penuh',
  'FullscreenControl.Exit': 'Keluar skrin penuh',
  'AttributionControl.ToggleAttribution': 'Tunjuk sumber peta',
  'CooperativeGesturesHandler.WindowsHelpText': 'Tekan Ctrl sambil menatal untuk zum peta',
  'CooperativeGesturesHandler.MacHelpText': 'Tekan ⌘ sambil menatal untuk zum peta',
  'CooperativeGesturesHandler.MobileHelpText': 'Guna dua jari untuk menggerakkan peta',
  'Map.Title': 'Peta Malaysia',
};
// Kuala Lumpur first, then by population: who keeps their marker when
// markers overlap.
const MAP_PRIORITY = [...MALAYSIA_STATES].sort((a, b) => (b.state === 'W.P. Kuala Lumpur') - (a.state === 'W.P. Kuala Lumpur') || b.population - a.population);

function setMapStatus(text) {
  const status = document.getElementById('map-status');
  status.textContent = text;
  status.hidden = !text;
}

async function createMalaysiaMap(state) {
  const css = el('link');
  css.rel = 'stylesheet';
  css.href = 'vendor/maplibre/maplibre-gl.css';
  document.head.append(css);
  const maplibregl = await import('./vendor/maplibre/maplibre-gl.mjs');

  const container = document.getElementById('my-map');
  // Fitted flat, then tilted: fitting while tilted leaves the near edge cut off.
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    bounds: container.clientWidth < 600 ? PENINSULA_BOUNDS : MALAYSIA_BOUNDS,
    fitBoundsOptions: { padding: { top: 40, bottom: 40, left: 40, right: 60 } },
    maxPitch: 70,
    maxBounds: [[94, -4], [125, 12]],
    cooperativeGestures: true,
    attributionControl: { compact: true },
    locale: MAP_LOCALE,
  });
  map.setPitch(MAP_PITCH);
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.FullscreenControl({ container: container.parentElement }), 'top-right');

  let reported = false;
  map.on('error', (event) => {
    console.info('Jam Dunia: sebahagian peta gagal dimuat.', event.error);
    if (!reported) setMapStatus('Sebahagian peta tidak dapat dimuat. Penanda bandar dan senarai di bawah masih berfungsi.');
    reported = true;
  });
  map.on('load', () => {
    // Relief shading everywhere, and real 3D hills once tilted and zoomed in.
    map.addSource('dem-terrain', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: DEM_ATTRIBUTION });
    map.addSource('dem-shade', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-shade', paint: { 'hillshade-exaggeration': 0.35 } }, firstSymbol);
    map.setTerrain({ source: 'dem-terrain', exaggeration: 1.5 });
  });

  const markers = new Map();
  for (const s of MALAYSIA_STATES) {
    const root = el('div', 'map-marker');
    const open = el('button', 'marker-open');
    open.type = 'button';
    open.setAttribute('aria-label', `Butiran ${s.capital}, ${s.state}`);
    const label = el('span', 'marker-label');
    label.append(el('strong', '', s.capital), el('span', 'marker-meta'));
    open.append(el('span', 'marker-photo'), el('span', 'marker-weather'), el('span', 'marker-aqi'), label);
    open.addEventListener('click', () => openCityDialog(state, s));
    const more = el('button', 'marker-more');
    more.type = 'button';
    more.hidden = true;
    more.addEventListener('click', () => map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom() + 2, LABEL_ZOOM) }));
    root.append(open, more);
    const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat([s.lon, s.lat]).addTo(map);
    markers.set(s.state, { root, marker, more });
  }

  // Markers that would overlap a more important one are hidden; the one kept
  // shows "+n" and zooms in to separate them.
  const declutter = () => {
    const labelled = map.getZoom() >= LABEL_ZOOM;
    container.classList.toggle('map-labelled', labelled);
    const [w, h] = labelled ? [130, 96] : [52, 52];
    const kept = [];
    for (const s of MAP_PRIORITY) {
      const m = markers.get(s.state);
      const p = map.project([s.lon, s.lat]);
      const owner = kept.find((k) => Math.abs(k.p.x - p.x) < w && Math.abs(k.p.y - p.y) < h);
      m.root.classList.toggle('is-covered', Boolean(owner));
      if (owner) owner.hidden += 1;
      else kept.push({ m, p, hidden: 0 });
    }
    for (const { m, hidden } of kept) {
      m.more.hidden = !hidden;
      m.more.textContent = `+${hidden}`;
      m.more.setAttribute('aria-label', `${hidden} lagi bandar berdekatan; zum masuk`);
    }
  };
  map.on('move', declutter);
  map.on('resize', declutter);
  declutter();

  return { map, markers };
}

function renderMapMarkers(state, view, now, photos, forecasts, air) {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  for (const s of MALAYSIA_STATES) {
    const { root } = view.markers.get(s.state);
    renderKeyed(root.querySelector('.marker-photo'), photos.status, () => {
      const photo = photos.status === 'ok' ? photos.data.get(s.landmark) : null;
      if (!photo) return [el('span', 'marker-initial', s.capital[0])];
      const img = el('img');
      img.src = photo.src;
      img.alt = '';
      img.decoding = 'async';
      return [img];
    });
    const forecast = forecasts.entry.status === 'ok' && Array.isArray(forecasts.entry.data)
      ? forecastForState(forecasts.entry.data, s.state, forecasts.iso) : null;
    const summary = forecast ? forecast.summary_forecast || forecast.afternoon_forecast || '' : '';
    renderKeyed(root.querySelector('.marker-weather'), summary, () => (forecast ? [weatherIcon(summary)] : []));
    root.querySelector('.marker-weather').title = summary;

    const { estimate } = air.forState(s);
    root.dataset.aqi = estimate ? estimate.band.id : '';
    renderKeyed(root.querySelector('.marker-aqi'), estimate ? `${estimate.index}` : '', () => (estimate ? [String(estimate.index)] : []));
    root.querySelector('.marker-aqi').title = estimate ? `IPU anggaran ${estimate.index}: ${estimate.band.label}` : '';

    const { today } = prayerFor(state, stateCity(s), now);
    const next = nextPrayer(today, now);
    renderKeyed(root.querySelector('.marker-meta'), `${forecast?.max_temp}|${next}|${minute}|${state.hour24}`, () => {
      const parts = [];
      if (forecast) parts.push(`${forecast.max_temp}°C`);
      if (next) parts.push(`🕌 ${PRAYER_TIMES.find(([f]) => f === next)[1]} ${formatClock(state, s.zone, today[next] * 1000)}`);
      return [parts.join(' · ')];
    });
  }
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
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
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
  state.localData = createLocalData(() => tick(state));
  state.dialogState = null;
  state.mapView = null; // created the first time the Bandar tab opens
  state.tab = showTab(window.location.hash);
  window.addEventListener('hashchange', () => {
    state.tab = showTab(window.location.hash);
    tick(state);
  });
  renderFacts();
  document.getElementById('city-dialog').addEventListener('close', () => { state.dialogState = null; });
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
    if (!card || e.target.closest('.remove, .local-toggle, .local-panel')) return;
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
