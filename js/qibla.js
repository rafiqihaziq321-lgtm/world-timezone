// Qibla direction, the live compass and "nearest town" (the viewer's location).

import { openCityDialog } from './dialog.js';
import { iconPaths } from './icons.js';
import { MAP_PLACES, placeName } from './places.js';
import { MINUTE_MS } from './time.js';
import { el } from './util.js';

export const KAABA = { lat: 21.4225, lon: 39.8262 };
export const COMPASS_POINTS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];

// Great-circle distance in km and initial bearing in degrees from north.
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function bearingTo(from, to) {
  const rad = Math.PI / 180;
  const dLon = (to.lon - from.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

export function qiblaText(place) {
  const bearing = bearingTo(place, KAABA);
  const km = Math.round(distanceKm(place, KAABA)).toLocaleString('ms-MY');
  return `${Math.round(bearing)}° dari utara (${COMPASS_POINTS[Math.round(bearing / 45) % 8]}) · ${km} km ke Kaabah`;
}

// A compass card with north marked and a needle towards the Kaaba. The
// .dial-turn group is rotated by the live compass so north stays north.
export function qiblaDial(bearing, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'qibla-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Anak panah kiblat, ${Math.round(bearing)} darjah dari utara`);
  svg.innerHTML = `<g class="dial-turn">
    <circle cx="50" cy="50" r="46" class="dial-face"/>
    <text x="50" y="16" class="dial-north">U</text>
    <g transform="rotate(${bearing.toFixed(1)} 50 50)">
      <path d="M50 26 L58 44 L52 41 L52 66 L48 66 L48 41 L42 44 Z" class="dial-needle"/>
      <g class="dial-kaaba" transform="translate(44.5 13.5) scale(0.46)">${iconPaths('kaaba')}</g>
    </g>
  </g>`;
  return svg;
}

export function qiblaSection(city) {
  const section = el('section', 'local-block qibla');
  section.append(el('h3', '', 'Arah kiblat'));
  const row = el('div', 'qibla-row');
  row.append(qiblaDial(bearingTo(city, KAABA), 56), el('p', '', qiblaText(city)));
  section.append(row);
  return section;
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation API tidak tersedia'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      reject,
      { timeout: 15000, maximumAge: 10 * MINUTE_MS },
    );
  });
}

export function locationErrorText(err) {
  if (err?.code === 1) return 'Kebenaran lokasi ditolak. Benarkan lokasi untuk laman ini dalam tetapan pelayar, kemudian cuba lagi.';
  if (err?.code === 2) return 'Lokasi anda tidak dapat ditentukan. Cuba lagi di tempat lain.';
  if (err?.code === 3) return 'Mencari lokasi mengambil masa terlalu lama. Cuba lagi.';
  return 'Pelayar ini tidak dapat memberikan lokasi anda.';
}

export function setupMapTools(state) {
  const status = document.getElementById('map-tools-status');
  const nearestEl = document.getElementById('map-nearest');
  nearestEl.addEventListener('click', () => {
    nearestEl.disabled = true;
    status.textContent = 'Mencari lokasi anda…';
    locate().then((here) => {
      const place = MAP_PLACES.reduce((best, p) => (distanceKm(here, p) < distanceKm(here, best) ? p : best));
      const km = Math.round(distanceKm(here, place)).toLocaleString('ms-MY');
      status.textContent = `Bandar terdekat: ${placeName(place)}, ${place.state} (kira-kira ${km} km dari anda).`;
      if (state.mapView?.status === 'ready') state.mapView.focus(place);
      else if (state.mapView?.status === 'loading') state.mapView.pendingFocus = place; // taken up once the map is ready
      openCityDialog(state, place);
    }, (err) => {
      console.info('Jam Dunia: lokasi tidak diperoleh.', err);
      status.textContent = locationErrorText(err);
    }).finally(() => {
      nearestEl.disabled = false;
    });
  });
  setupQiblaCompass();
}

// The live compass: the viewer's own position, turned by the phone's
// orientation sensor where there is one.
export function setupQiblaCompass() {
  const dialog = document.getElementById('qibla-dialog');
  const dial = document.getElementById('qibla-dial');
  const reading = document.getElementById('qibla-reading');
  const status = document.getElementById('qibla-status');
  let stop = null; // ends the sensor listening started for the open dialog
  let opened = 0; // which opening is current, so a slow earlier one gives up

  document.getElementById('qibla-open').addEventListener('click', async () => {
    const run = ++opened;
    dialog.showModal();
    dial.replaceChildren();
    reading.textContent = '';
    status.textContent = 'Mencari lokasi anda…';
    // iOS lets a page read the compass only after asking, from a tap.
    const motion = typeof window.DeviceOrientationEvent?.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission().catch((err) => {
        console.info('Jam Dunia: akses sensor arah tidak diberi.', err);
        return 'denied';
      })
      : Promise.resolve('granted');

    let here;
    try {
      here = await locate();
    } catch (err) {
      console.info('Jam Dunia: lokasi tidak diperoleh.', err);
      status.textContent = locationErrorText(err);
      return;
    }
    if (!dialog.open || run !== opened) return;
    const bearing = bearingTo(here, KAABA);
    const svg = qiblaDial(bearing, 220);
    dial.replaceChildren(svg);
    reading.textContent = qiblaText(here);
    const fixed = 'Anak panah menunjuk kiblat dari utara (U). Hadapkan "U" ke utara untuk mengikutnya.';
    const allowed = (await motion) === 'granted';
    if (!dialog.open || run !== opened) return;
    if (!allowed) {
      status.textContent = fixed;
      return;
    }

    const turn = svg.querySelector('.dial-turn');
    const event = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    let turning = false;
    const onTurn = (e) => {
      // Safari gives a compass heading; others an absolute alpha (anticlockwise).
      const heading = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading
        : e.absolute && e.alpha !== null ? (360 - e.alpha) % 360 : null;
      if (heading === null) return;
      const facing = heading + (screen.orientation?.angle ?? 0);
      turn.setAttribute('transform', `rotate(${(-facing).toFixed(1)} 50 50)`);
      if (!turning) status.textContent = 'Pegang telefon mendatar. Anak panah menunjuk arah kiblat.';
      turning = true;
    };
    window.addEventListener(event, onTurn);
    const noCompass = setTimeout(() => {
      if (!turning) status.textContent = `Peranti ini tiada kompas. ${fixed}`;
    }, 3000);
    stop = () => {
      window.removeEventListener(event, onTurn);
      clearTimeout(noCompass);
    };
    status.textContent = 'Menunggu kompas peranti…';
  });
  dialog.addEventListener('close', () => {
    stop?.();
    stop = null;
  });
}
