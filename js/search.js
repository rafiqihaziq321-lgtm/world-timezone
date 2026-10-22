// City search over the bundled city database.

import { makeCity } from './storage.js';
import { normalizeName } from './util.js';

// Finds "Name" or "Name, Country" in the city list (rows are most populous
// first, so a bare "George Town" is the one in Penang).
export function findCity(rows, query) {
  const [name, country] = query.split(/,(?=[^,]*$)/).map(normalizeName);
  const row = rows.find((r) => normalizeName(r[0]) === name && (country === undefined || normalizeName(r[1]) === country));
  return row ? makeCity(row[0], row[2], row[3], row[4]) : null;
}

// vendor/cities.js is ~400 KB, so it is only fetched once someone searches
// (or opens a shared link that needs city positions).
export function createCityListLoader() {
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
