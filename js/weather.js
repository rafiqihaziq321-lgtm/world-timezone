// Current weather on the city cards, from Open-Meteo's forecast model.

import { el, renderKeyed } from './util.js';

export const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const REFRESH_MS = 15 * 60 * 1000;

// WMO weather codes as Open-Meteo reports them: [codes, day icon, night icon, label].
const WMO_CODES = [
  [[0], '☀️', '🌙', 'Cerah'],
  [[1], '🌤️', '🌙', 'Kebanyakannya cerah'],
  [[2], '⛅', '☁️', 'Separa berawan'],
  [[3], '☁️', '☁️', 'Mendung'],
  [[45, 48], '🌫️', '🌫️', 'Berkabus'],
  [[51, 53, 55], '🌦️', '🌧️', 'Gerimis'],
  [[56, 57], '🌧️', '🌧️', 'Gerimis beku'],
  [[61, 63, 65], '🌧️', '🌧️', 'Hujan'],
  [[66, 67], '🌧️', '🌧️', 'Hujan beku'],
  [[71, 73, 75, 77], '🌨️', '🌨️', 'Salji'],
  [[80, 81, 82], '🌦️', '🌧️', 'Hujan sekejap-sekejap'],
  [[85, 86], '🌨️', '🌨️', 'Salji sekejap-sekejap'],
  [[95], '⛈️', '⛈️', 'Ribut petir'],
  [[96, 99], '⛈️', '⛈️', 'Ribut petir dan hujan batu'],
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

export function renderWeatherLine(node, current) {
  const weather = current && Number.isFinite(current.temperature_2m) ? describeWeather(current.weather_code, current.is_day === 1) : null;
  renderKeyed(node, weather ? `${current.temperature_2m}|${current.weather_code}|${current.is_day}` : '', () => {
    if (!weather) return [];
    const icon = el('span', '', weather.icon);
    icon.setAttribute('aria-hidden', 'true');
    return [icon, ` ${String(Math.round(current.temperature_2m)).replace('-', '−')}°C ${weather.label}`];
  });
}
