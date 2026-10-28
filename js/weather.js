// Current weather on the city cards, from Open-Meteo's forecast model.

import { icon } from './icons.js';
import { retryButton } from './local-panel.js';
import { saveState } from './storage.js';
import { HOUR_MS, formatClock } from './time.js';
import { el, formatTemp, renderKeyed } from './util.js';

export const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_MS = 15 * 60 * 1000;

// WMO weather codes as Open-Meteo reports them: [codes, day icon, night icon, label].
const WMO_CODES = [
  [[0], 'sun', 'moon', 'Cerah'],
  [[1], 'sun-cloud', 'moon', 'Kebanyakannya cerah'],
  [[2], 'sun-cloud', 'moon-cloud', 'Separa berawan'],
  [[3], 'cloud', 'cloud', 'Mendung'],
  [[45, 48], 'fog', 'fog', 'Berkabus'],
  [[51, 53, 55], 'drizzle', 'drizzle', 'Gerimis'],
  [[56, 57], 'drizzle', 'drizzle', 'Gerimis beku'],
  [[61, 63, 65], 'rain', 'rain', 'Hujan'],
  [[66, 67], 'rain', 'rain', 'Hujan beku'],
  [[71, 73, 75, 77], 'snow', 'snow', 'Salji'],
  [[80, 81, 82], 'rain', 'rain', 'Hujan sekejap-sekejap'],
  [[85, 86], 'snow', 'snow', 'Salji sekejap-sekejap'],
  [[95], 'storm', 'storm', 'Ribut petir'],
  [[96, 99], 'storm', 'storm', 'Ribut petir dan hujan batu'],
];

export function describeWeather(code, isDay) {
  const row = WMO_CODES.find(([codes]) => codes.includes(code));
  return row ? { icon: isDay ? row[1] : row[2], label: row[3] } : null;
}

const place = (city) => `${city.lat.toFixed(2)},${city.lon.toFixed(2)}`;

// One request for every card with a position, refreshed every 15 minutes.
// Places are sorted so reordering cards does not fetch again.
export function currentWeather(state) {
  const places = [...new Set(state.cities.filter((c) => c.lat !== null && c.lon !== null).map(place))].sort();
  const key = `cuaca|${Math.floor(Date.now() / REFRESH_MS)}|${places.join(';')}`;
  const entry = places.length
    ? state.localData.get(key, `${FORECAST_API}?latitude=${places.map((p) => p.split(',')[0]).join(',')}&longitude=${places.map((p) => p.split(',')[1]).join(',')}&current=temperature_2m,weather_code,is_day`)
    : null;
  // A single place comes back as an object, several as a list in request order.
  const rows = entry?.status === 'ok' ? [entry.data].flat() : [];
  return (city) => (city.lat === null || city.lon === null ? null : rows[places.indexOf(place(city))]?.current ?? null);
}

// The line on a card, a button that opens the next 12 hours below it.
export function renderWeatherLine(state, node, current) {
  const weather = current && Number.isFinite(current.temperature_2m) ? describeWeather(current.weather_code, current.is_day === 1) : null;
  const open = node.closest('.card').dataset.hourly === 'open';
  renderKeyed(node, weather ? `${current.temperature_2m}|${current.weather_code}|${current.is_day}|${state.tempUnit}|${open}` : '', () => {
    if (!weather) return [];
    const toggle = el('button', 'weather-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.append(icon(weather.icon), ` ${formatTemp(state, current.temperature_2m)} ${weather.label}`, el('span', 'visually-hidden', ', ramalan 12 jam'));
    return [toggle];
  });
}

// The next 12 hours for a card, fetched when first opened and each hour after.
export function renderHourly(state, card, city) {
  const box = card.querySelector('.hourly');
  box.hidden = card.dataset.hourly !== 'open' || city.lat === null || city.lon === null;
  if (box.hidden) return;
  const key = `cuaca-jam|${place(city)}|${Math.floor(Date.now() / HOUR_MS)}`;
  const entry = state.localData.get(key, `${FORECAST_API}?latitude=${city.lat.toFixed(2)}&longitude=${city.lon.toFixed(2)}`
    + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=12&timeformat=unixtime');
  renderKeyed(box, [key, entry.status, state.tempUnit, state.hour24].join('|'), () => {
    if (entry.status === 'loading') return [el('p', 'local-status', 'Memuatkan ramalan…')];
    if (entry.status === 'error') return [el('p', 'local-status', 'Ramalan gagal dimuat. '), retryButton(state, key)];
    const hourly = entry.data.hourly ?? {};
    const list = el('ol', 'hourly-list');
    list.setAttribute('aria-label', `Ramalan 12 jam, ${city.name}`);
    list.tabIndex = 0; // it scrolls sideways on narrow cards; Safari does not focus scrollers by itself
    (hourly.time ?? []).forEach((t, i) => {
      const weather = describeWeather(hourly.weather_code?.[i], hourly.is_day?.[i] === 1);
      const item = el('li');
      item.append(el('span', 'hourly-time', formatClock(state, city.zone, t * 1000)));
      if (weather) item.append(icon(weather.icon), el('span', 'visually-hidden', weather.label));
      const temp = hourly.temperature_2m?.[i];
      item.append(el('strong', '', Number.isFinite(temp) ? formatTemp(state, temp) : '—')); // null is a gap, not 0°
      const rain = hourly.precipitation_probability?.[i];
      if (Number.isFinite(rain)) item.append(el('span', 'hourly-rain', `${rain}%`), el('span', 'visually-hidden', ' peluang hujan'));
      list.append(item);
    });
    return [list, el('p', 'hourly-source', 'Ramalan Open-Meteo; peratus ialah peluang hujan.')];
  });
}

// The card's weather line opens and closes its hours; °C/°F applies everywhere.
export function setupWeather(state, clocksEl) {
  clocksEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('.weather-toggle');
    if (!toggle) return;
    const card = toggle.closest('.card');
    card.dataset.hourly = card.dataset.hourly === 'open' ? '' : 'open';
    state.refresh();
  });
  const unitButtons = document.querySelectorAll('.unit-toggle [data-unit]');
  const show = () => {
    for (const b of unitButtons) b.setAttribute('aria-pressed', String(b.dataset.unit === state.tempUnit));
  };
  for (const b of unitButtons) {
    b.addEventListener('click', () => {
      state.tempUnit = b.dataset.unit;
      saveState(state);
      show();
      state.refresh();
    });
  }
  show();
}
