// Jam Dunia: the page's entry point. Wires the controls to the state and
// redraws every second (tick). Each part of the page lives in js/.

import { cityKey, createGlobe } from './globe.js';
import { addCity, clocksEl, describeCity, flashCard, renderCards, renderSunLine } from './js/cards.js';
import { renderCities } from './js/cities.js';
import { renderLocalPanel } from './js/local-panel.js';
import { renderFacts, renderMalaysia } from './js/malaysia.js';
import { plannerTableEl, renderPlanner, setupWorkSettings } from './js/planner.js';
import { setupMapTools } from './js/qibla.js';
import { checkReminders, setupReminders } from './js/reminders.js';
import { createCityListLoader, findCity } from './js/search.js';
import { clearShareParams, copyShareLink, readShareParams } from './js/share.js';
import { cityForZone, loadState, makeCity, saveState } from './js/storage.js';
import { showTab } from './js/tabs.js';
import { applyTheme, systemDark, themeEl } from './js/theme.js';
import { ALL_ZONES, HOUR_MS, LOCAL_ZONE, MINUTE_MS, PHASES, QUARTER_MS, cityName, cityPhase, dayPhase, displayDate, floorToQuarter, formatDiff, formatUtcOffset, isValidZone, minuteOfDay, signedDuration, utcOffsetMinutes } from './js/time.js';
import { createLocalData, normalizeName } from './js/util.js';

const formEl = document.getElementById('add-form');
const inputEl = document.getElementById('zone-input');
const listEl = document.getElementById('zone-list');
const errorEl = document.getElementById('form-error');
const format24El = document.getElementById('format24');
const timeSliderEl = document.getElementById('time-slider');
const timeLabelEl = document.getElementById('time-label');
const timeResetEl = document.getElementById('time-reset');
const playEl = document.getElementById('time-play');
const zoomInEl = document.getElementById('zoom-in');
const zoomOutEl = document.getElementById('zoom-out');
const shareEl = document.getElementById('share');
const installEl = document.getElementById('install');
const shareBannerEl = document.getElementById('share-banner');
const shareSaveEl = document.getElementById('share-save');
const shareExitEl = document.getElementById('share-exit');
const heroPlaceEl = document.getElementById('hero-place');
const heroTimeEl = document.getElementById('hero-time');
const heroDateEl = document.getElementById('hero-date');

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
    const phase = city ? cityPhase(city, now.getTime()) : dayPhase(minutes);
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
    if (city) renderSunLine(state, card.querySelector('.sun'), city, now);
    card.querySelector('.hand.hour').setAttribute('transform', `rotate(${(minutes % 720) / 2} 50 50)`);
    card.querySelector('.hand.minute').setAttribute('transform', `rotate(${(minutes % 60) * 6 + seconds / 10} 50 50)`);
    card.querySelector('.hand.second').setAttribute('transform', `rotate(${seconds * 6} 50 50)`);
    const panel = card.querySelector('.local-panel');
    if (panel && !panel.hidden && city) renderLocalPanel(state, panel, city, now);
  }
  renderPlanner(state, now);
  checkReminders(state, Date.now()); // real time, not the time chosen on the slider
  if (state.tab === 'malaysia') renderMalaysia(state, now);
  if (state.tab === 'bandar-malaysia') renderCities(state, now);
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
  // Parts of the page ask for a redraw through state.refresh() (they cannot
  // import tick from here without a circular import).
  state.refresh = () => tick(state);
  state.localData = createLocalData(() => tick(state));
  state.dialogState = null;
  state.mapView = null; // created the first time the Bandar tab opens
  state.ramadanState = 'W.P. Kuala Lumpur'; // whose imsak and berbuka the Ramadan countdown shows
  state.tab = showTab(window.location.hash);
  // The skip link goes to the title of the tab on screen, without switching tabs.
  document.querySelector('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    const title = document.querySelector('.tab-panel:not([hidden]) :is(h1, h2)');
    title.tabIndex = -1;
    title.focus();
  });
  window.addEventListener('hashchange', () => {
    state.tab = showTab(window.location.hash);
    tick(state);
  });
  renderFacts();
  setupWorkSettings(state);
  setupMapTools(state);
  setupReminders(state);
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
  // Chromium browsers (Chrome, Edge, Android) announce that the app can be
  // installed; we keep that offer for our own button. Safari and Firefox
  // install from their own menus, so the button stays hidden there.
  let installOffer = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installOffer = e;
    installEl.hidden = false;
  });
  installEl.addEventListener('click', () => {
    const offer = installOffer;
    installOffer = null; // an offer can be shown once; the browser sends another if declined
    installEl.hidden = true;
    offer?.prompt().catch((err) => console.warn('Pemasangan app tidak dapat dimulakan.', err));
  });
  window.addEventListener('appinstalled', () => {
    installOffer = null;
    installEl.hidden = true;
  });

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
    if (!card || e.target.closest('.remove, .drag-handle, .local-toggle, .local-panel')) return;
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
