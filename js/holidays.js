// Malaysian public holidays for the cities in the planner, by their state.

import { isMalaysian } from './local-panel.js';
import { MAP_PLACES, placeName } from './places.js';

// The table (js/my-holidays.js) is fetched only once the planner comes near
// the screen (state.holidaysWanted, set by the planner): most visits never
// scroll that far, so the first load stays light.
function table(state) {
  if (!state.holidaysWanted) return null;
  const entry = state.localData.get('cuti-umum', () => import('./my-holidays.js').then((m) => m.MY_HOLIDAYS));
  return entry.status === 'ok' ? entry.data : null;
}

export function holidaysLoaded(state) {
  return table(state) !== null;
}

// The state a Malaysian city is in: a capital or town we know by name, else
// the nearest one by position. null outside Malaysia, or with neither.
export function malaysianState(city) {
  if (!isMalaysian(city)) return null;
  const named = MAP_PLACES.find((p) => placeName(p) === city.name);
  if (named) return named.state;
  if (city.lat === null || city.lon === null) return null;
  const cos = Math.cos((city.lat * Math.PI) / 180);
  const distance = (p) => (p.lat - city.lat) ** 2 + ((p.lon - city.lon) * cos) ** 2;
  return MAP_PLACES.reduce((best, p) => (distance(p) < distance(best) ? p : best)).state;
}

// The holidays a city keeps on its own date `day` (YYYY-MM-DD). A Malaysian
// city whose state is unknown keeps only those every state keeps.
export function holidaysFor(state, city, day) {
  const rows = table(state);
  if (rows === null || !isMalaysian(city)) return [];
  const region = malaysianState(city);
  return rows
    .filter(([date, , states]) => date === day && (states === null || (region !== null && states.includes(region))))
    .map(([, name]) => name);
}
