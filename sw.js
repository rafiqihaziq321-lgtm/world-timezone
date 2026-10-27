// Service worker: lets Jam Dunia open without a connection.
// Strategy is stale-while-revalidate: answer from the cache at once, then
// refresh that cache from the network so the next visit gets updates.
// Bump CACHE when the precache list changes so old caches are cleared.
const CACHE = 'jam-dunia-v8';

// The app shell. vendor/cities.js (~400 KB) is not precached: it is cached the
// first time someone searches, keeping the first visit light.
const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'globe.js',
  'malaysia-data.js',
  'js/air.js',
  'js/calendar.js',
  'js/cards.js',
  'js/cities.js',
  'js/dialog.js',
  'js/icons.js',
  'js/jakim-zones.js',
  'js/local-panel.js',
  'js/malaysia.js',
  'js/map.js',
  'js/places.js',
  'js/planner.js',
  'js/qibla.js',
  'js/reminders.js',
  'js/search.js',
  'js/share.js',
  'js/storage.js',
  'js/tabs.js',
  'js/theme.js',
  'js/time.js',
  'js/util.js',
  'js/warnings.js',
  'js/weather.js',
  'js/zones.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'vendor/d3-array.min.js',
  'vendor/d3-geo.min.js',
  'vendor/topojson-client.min.js',
  'vendor/land-110m.js',
  'vendor/fonts/unbounded-latin-wght-normal.woff2',
  'vendor/fonts/manrope-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Share links differ only in their query string; they all use the same page.
  const key = url.origin + url.pathname;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const fresh = fetch(event.request).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (!cached) return fresh;
    // Offline: the cached copy is the answer, so a failed refresh is expected.
    event.waitUntil(fresh.catch((err) => console.info('Jam Dunia: guna salinan cache untuk', key, err.message)));
    return cached;
  }));
});
