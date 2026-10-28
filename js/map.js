// The 3D map of Malaysia (MapLibre, OpenFreeMap, AWS terrain).

import { openCityDialog } from './dialog.js';
import { icon } from './icons.js';
import { PRAYER_TIMES, nextPrayer, prayerFor, weatherIcon } from './local-panel.js';
import { forecastForState, forecastForTown } from './malaysia.js';
import { MAP_PLACES, placeName, stateCity } from './places.js';
import { MINUTE_MS, formatClock } from './time.js';
import { el, fetchJson, formatTemp, renderKeyed } from './util.js';
import { WARNING_LEVELS, activeWarnings, warningArea, warningLevels } from './warnings.js';
import { MALAYSIA_STATES, MALAYSIA_TOWNS } from '../malaysia-data.js';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_ATTRIBUTION = '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Rupa bumi: Mapzen, AWS</a>';
export const MALAYSIA_BOUNDS = [[99.6, 0.85], [119.3, 7.4]];
export const PENINSULA_BOUNDS = [[99.6, 1.2], [104.4, 6.75]]; // phones: Borneo is a swipe away
export const MAP_PITCH = 35;
export const LABEL_ZOOM = 6.5; // markers show their name and readings from here in
export const WARNING_COLORS = { alert: '#facc15', severe: '#f97316', danger: '#dc2626' };
export const MAP_LOCALE = {
  'NavigationControl.ZoomIn': 'Zum masuk',
  'NavigationControl.ZoomOut': 'Zum keluar',
  'NavigationControl.ResetBearing': 'Seret untuk memutar, klik untuk menghala ke utara',
  'FullscreenControl.Enter': 'Skrin penuh',
  'FullscreenControl.Exit': 'Keluar skrin penuh',
  'AttributionControl.ToggleAttribution': 'Tunjuk sumber peta',
  'CooperativeGesturesHandler.WindowsHelpText': 'Tekan Ctrl sambil menatal untuk zum peta',
  'CooperativeGesturesHandler.MacHelpText': 'Tekan ⌘ sambil menatal untuk zum peta',
  'CooperativeGesturesHandler.MobileHelpText': 'Guna dua jari untuk menggerakkan peta',
  'Map.Title': 'Peta interaktif Malaysia',
};
// Kuala Lumpur first, then by population: who keeps their marker when
// markers overlap.
export const MAP_PRIORITY = [
  ...[...MALAYSIA_STATES].sort((a, b) => (b.state === 'W.P. Kuala Lumpur') - (a.state === 'W.P. Kuala Lumpur') || b.population - a.population),
  ...MALAYSIA_TOWNS,
];

export function setMapStatus(text) {
  const status = document.getElementById('map-status');
  status.textContent = text;
  status.hidden = !text;
}

export async function createMalaysiaMap(state) {
  const css = el('link');
  css.rel = 'stylesheet';
  css.href = 'vendor/maplibre/maplibre-gl.css';
  document.head.append(css);
  const maplibregl = await import('../vendor/maplibre/maplibre-gl.mjs');

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
  // States under a MET warning, coloured by its level. The outlines arrive
  // after the style; until then the latest levels wait in `pending`.
  let pending = {};
  let outlinesReady = false;
  const paintWarnings = (levels) => {
    const pairs = Object.entries(levels).flatMap(([name, level]) => [name, WARNING_COLORS[level]]);
    const color = pairs.length ? ['match', ['get', 'state'], ...pairs, 'rgba(0, 0, 0, 0)'] : 'rgba(0, 0, 0, 0)';
    map.setPaintProperty('amaran-isi', 'fill-color', color);
    map.setPaintProperty('amaran-garis', 'line-color', color);
  };

  map.on('load', () => {
    // Relief shading everywhere, and real 3D hills once tilted and zoomed in.
    map.addSource('dem-terrain', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: DEM_ATTRIBUTION });
    map.addSource('dem-shade', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-shade', paint: { 'hillshade-exaggeration': 0.35 } }, firstSymbol);
    map.setTerrain({ source: 'dem-terrain', exaggeration: 1.5 });

    fetchJson('data/malaysia-states.json').then((outlines) => {
      map.addSource('negeri', { type: 'geojson', data: outlines, attribution: 'Sempadan negeri: DOSM' });
      map.addLayer({ id: 'amaran-isi', type: 'fill', source: 'negeri', paint: { 'fill-color': 'rgba(0, 0, 0, 0)', 'fill-opacity': 0.35 } }, firstSymbol);
      map.addLayer({ id: 'amaran-garis', type: 'line', source: 'negeri', paint: { 'line-color': 'rgba(0, 0, 0, 0)', 'line-width': 2 } }, firstSymbol);
      outlinesReady = true;
      paintWarnings(pending);
    }, (err) => {
      console.info('Jam Dunia: sempadan negeri tidak dapat dimuat.', err);
      setMapStatus('Sempadan negeri tidak dapat dimuat, jadi kawasan amaran tidak diwarnakan pada peta.');
    });
  });

  const markers = new Map();
  for (const s of MAP_PLACES) {
    const root = el('div', s.capital ? 'map-marker' : 'map-marker town');
    const open = el('button', 'marker-open');
    open.type = 'button';
    open.setAttribute('aria-label', `Butiran ${placeName(s)}, ${s.state}`);
    const label = el('span', 'marker-label');
    label.append(el('strong', '', placeName(s)), el('span', 'marker-meta'));
    open.append(el('span', 'marker-photo'), el('span', 'marker-weather'), el('span', 'marker-aqi'), label);
    open.addEventListener('click', () => openCityDialog(state, s));
    const more = el('button', 'marker-more');
    more.type = 'button';
    more.hidden = true;
    more.addEventListener('click', () => map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom() + 2, LABEL_ZOOM) }));
    root.append(open, more);
    const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat([s.lon, s.lat]).addTo(map);
    markers.set(placeName(s), { root, marker, more });
  }

  // Markers that would overlap a more important one are hidden; the one kept
  // shows "+n" and zooms in to separate them. Towns appear only once zoomed
  // in far enough for labels, and are not counted before that. A place the
  // map was sent to (focus) comes first.
  let focused = null;
  const declutter = () => {
    const labelled = map.getZoom() >= LABEL_ZOOM;
    container.classList.toggle('map-labelled', labelled);
    const [w, h] = labelled ? [130, 96] : [84, 84]; // zoomed out, the short name tag below each marker sets the size
    const kept = [];
    const order = focused ? [focused, ...MAP_PRIORITY.filter((p) => p !== focused)] : MAP_PRIORITY;
    for (const s of order) {
      const m = markers.get(placeName(s));
      if (!s.capital && !labelled && s !== focused) {
        m.root.classList.add('is-covered');
        continue;
      }
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

  return {
    map,
    markers,
    focus(place) {
      focused = place;
      map.flyTo({ center: [place.lon, place.lat], zoom: 9 });
      declutter();
    },
    showWarnings(levels) {
      pending = levels;
      if (outlinesReady) paintWarnings(levels);
    },
  };
}

// Land warnings in force: their states coloured on the map, and listed on it.
export function renderMapWarnings(state, view, now) {
  const { entry, active } = activeWarnings(state, now);
  const land = active.map((w) => ({ w, ...warningArea(w) })).filter((a) => a.states.length);
  const levels = warningLevels(active);
  const levelsKey = JSON.stringify(levels);
  if (view.warningsKey !== levelsKey) {
    view.warningsKey = levelsKey;
    view.showWarnings(levels);
  }
  const box = document.getElementById('map-warnings');
  box.hidden = entry.status !== 'ok' || !land.length;
  renderKeyed(box, levelsKey + land.map((a) => a.w.text_bm).join('|'), () => {
    const list = el('ul');
    for (const { w, states, level } of land) {
      const item = el('li');
      const dot = el('span', 'warning-dot');
      dot.style.background = WARNING_COLORS[level];
      item.append(dot, el('strong', '', w.warning_issue?.title_bm || w.heading_bm || WARNING_LEVELS[level]), `: ${states.map((n) => n.replace(/^W\.P\. /, '')).join(', ')}`);
      list.append(item);
    }
    const title = el('p', 'map-warnings-title');
    title.append(icon('warning'), ' Amaran MET aktif');
    return [title, list];
  });
}

// "Kuala Lumpur" -> "KL", "Ipoh" -> "Ip": in place of a photo that did not load.
function initials(name) {
  const words = name.split(/\s+/);
  return words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : name.slice(0, 2);
}

export function renderMapMarkers(state, view, now, photos, forecasts, towns, air) {
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  for (const s of MAP_PLACES) {
    const { root } = view.markers.get(placeName(s));
    renderKeyed(root.querySelector('.marker-photo'), photos.status, () => {
      const photo = photos.status === 'ok' && s.landmark ? photos.data.get(s.landmark) : null;
      if (!photo) return [el('span', 'marker-initial', initials(placeName(s)))];
      const img = el('img');
      img.width = 48; // a square thumbnail; CSS sets the drawn size
      img.height = 48;
      img.src = photo.src;
      img.alt = '';
      img.decoding = 'async';
      return [img];
    });
    const forecast = s.capital
      ? (forecasts.entry.status === 'ok' && Array.isArray(forecasts.entry.data) ? forecastForState(forecasts.entry.data, s.state, forecasts.iso) : null)
      : (towns.entry.status === 'ok' && Array.isArray(towns.entry.data) ? forecastForTown(towns.entry.data, s, towns.iso) : null);
    const summary = forecast ? forecast.summary_forecast || forecast.afternoon_forecast || '' : '';
    renderKeyed(root.querySelector('.marker-weather'), summary, () => (forecast ? [weatherIcon(summary)] : []));
    root.querySelector('.marker-weather').title = summary;

    const { estimate } = air.forState(s);
    root.dataset.aqi = estimate ? estimate.band.id : '';
    renderKeyed(root.querySelector('.marker-aqi'), estimate ? `${estimate.index}` : '', () => (estimate ? [String(estimate.index)] : []));
    root.querySelector('.marker-aqi').title = estimate ? `IPU anggaran ${estimate.index}: ${estimate.band.label}` : '';

    // Capitals only: a town's prayer times are fetched when its dialog opens.
    const today = s.capital ? prayerFor(state, stateCity(s), now).today : null;
    const next = nextPrayer(today, now);
    renderKeyed(root.querySelector('.marker-meta'), `${forecast?.max_temp}|${next}|${minute}|${state.hour24}|${state.tempUnit}`, () => {
      const parts = [];
      if (forecast) parts.push(formatTemp(state, forecast.max_temp));
      if (next) {
        if (parts.length) parts.push(' · ');
        parts.push(icon('mosque'), ` ${PRAYER_TIMES.find(([f]) => f === next)[1]} ${formatClock(state, s.zone, today[next] * 1000)}`);
      }
      return parts;
    });
  }
}

// ---------- Qibla and "nearest town" (the viewer's location) ----------
