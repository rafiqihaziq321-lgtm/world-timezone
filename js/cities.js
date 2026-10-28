// The Bandar Malaysia tab: map, landmark photos and city cards.

import { stateAirQuality } from './air.js';
import { openCityDialog } from './dialog.js';
import { icon } from './icons.js';
import { PRAYER_TIMES, nextPrayer, prayerFor, renderLocalPanel, weatherIcon } from './local-panel.js';
import { forecastForState, stateForecasts, townForecasts } from './malaysia.js';
import { stateCity } from './places.js';
import { MINUTE_MS, formatClock } from './time.js';
import { el, fetchJson, formatTempRange, renderKeyed } from './util.js';
import { MALAYSIA_STATES } from '../malaysia-data.js';

export const WIKI_API = 'https://en.wikipedia.org/w/api.php';

// Lead photos of each landmark's Wikipedia article, with author and licence
// from Wikimedia Commons: two batched requests for all 16 cities.
export async function loadLandmarkPhotos() {
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

export function photoCredit(photo) {
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

export function photoElement(s, photo, sizes) {
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

export function renderCities(state, now) {
  const grid = document.getElementById('my-cities');
  const photos = state.localData.get('foto-landmark', loadLandmarkPhotos);
  const forecasts = stateForecasts(state, now);
  const air = stateAirQuality(state);
  const minute = Math.floor(now.getTime() / MINUTE_MS);

  if (!state.mapView) {
    state.mapView = { status: 'loading' };
    // The map's code, like MapLibre itself, is fetched when this tab is first
    // drawn: most visits never open it, so the first load stays light.
    import('./map.js').then((lib) => lib.createMalaysiaMap(state).then((view) => ({ lib, view }))).then(({ lib, view }) => {
      Object.assign(state.mapView, { status: 'ready', lib }, view);
      state.refresh();
    }, (err) => {
      state.mapView.status = 'error';
      console.info('Jam Dunia: peta 3D tidak dapat dipaparkan.', err);
      const status = document.getElementById('map-status');
      status.textContent = 'Peta 3D tidak dapat dipaparkan: pelayar ini mungkin tidak menyokong WebGL, atau fail peta gagal dimuat. Senarai bandar di bawah masih berfungsi.';
      status.hidden = false;
    });
  }
  if (state.mapView.status === 'ready') {
    state.mapView.lib.renderMapMarkers(state, state.mapView, now, photos, forecasts, townForecasts(state, now), air);
    state.mapView.lib.renderMapWarnings(state, state.mapView, now);
  }

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
    renderKeyed(card.querySelector('.city-now'), `${entry.status}|${forecasts.entry.status}|${estimate?.index}|${minute}|${state.hour24}|${state.tempUnit}`, () => {
      const lines = [];
      if (forecast) {
        const summary = forecast.summary_forecast || forecast.afternoon_forecast || '';
        const line = el('span');
        line.append(weatherIcon(summary), ` ${summary}, ${formatTempRange(state, forecast.min_temp, forecast.max_temp)}`);
        lines.push(line);
      }
      const next = nextPrayer(today, now);
      if (next) {
        const label = PRAYER_TIMES.find(([f]) => f === next)[1];
        const line = el('span');
        line.append(icon('mosque'), ` ${label} ${formatClock(state, s.zone, today[next] * 1000)}`);
        lines.push(line);
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
    if (s.landmark) renderKeyed(dialog.querySelector('.dialog-photo'), photos.status, () => {
      const photo = photos.status === 'ok' ? photos.data.get(s.landmark) : null;
      return [photoElement(s, photo, '(max-width: 700px) 100vw, 640px'), ...(photo ? [photoCredit(photo)] : [])];
    });
  }
}
