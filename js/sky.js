// The living sky behind every tab (DESIGN.md, "Langit hidup"). Everything it
// shows comes from data the page already has:
// - its colour from the sun at the viewer's place, at the time shown (so the
//   time slider and a dragged sun strip move it);
// - at night, stars, and the Moon in its real phase where it is up;
// - the current weather there as a light layer: cloud, rain, rare lightning in
//   a thunderstorm, snow, haze.
// Decorative (aria-hidden): the same facts are written on the cards.

import { moonHeight, moonPhase } from './moon.js';
import { HOUR_MS, LOCAL_ZONE, cityDate, sunTimes, zonedTime } from './time.js';

const FRAME_MS = 1000 / 30; // at most 30 frames a second
const PARALLAX_PX = 8;
const STOPS = ['night', 'dawn', 'day', 'dusk'];

const skyEl = document.getElementById('sky');
const canvas = skyEl.querySelector('canvas');
const ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Colour: where the sun is ----------

// Sunrise and sunset for the viewer: from their city's position, or the fixed
// hours the cards use for a place without one (06:00 and 18:00).
function sunEdges(home, ms) {
  if (home) return sunTimes(home, ms);
  const { year, month, day } = cityDate(LOCAL_ZONE, new Date(ms));
  return { rise: zonedTime(LOCAL_ZONE, year, month, day, 6, 0), set: zonedTime(LOCAL_ZONE, year, month, day, 18, 0) };
}

// The part of the day at `ms`, as two stops and how far from one to the other.
// Dawn and dusk are the hour either side of sunrise and sunset, as on the cards.
export function skyAt(home, ms) {
  const sun = sunEdges(home, ms);
  if (sun.polar) return { from: sun.polar, to: sun.polar, k: 0 };
  const blends = [[sun.rise - HOUR_MS, 'night', 'dawn'], [sun.rise, 'dawn', 'day'], [sun.set - HOUR_MS, 'day', 'dusk'], [sun.set, 'dusk', 'night']];
  for (const [t0, from, to] of blends) if (ms >= t0 && ms < t0 + HOUR_MS) return { from, to, k: (ms - t0) / HOUR_MS };
  const still = ms > sun.rise && ms < sun.set ? 'day' : 'night';
  return { from: still, to: still, k: 0 };
}

const DARK = { night: 1, dawn: 0.5, dusk: 0.5, day: 0 };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => `#${hex(a).map((x, i) => Math.round(x + (hex(b)[i] - x) * k).toString(16).padStart(2, '0')).join('')}`;

// The theme's sky colours, read from its tokens (style.css) whenever the theme changes.
let tokens = null;
function readTokens() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(name).trim();
  tokens = Object.fromEntries(STOPS.map((s) => [s, [get(`--sky-${s}-top`), get(`--sky-${s}-bottom`)]]));
  Object.assign(tokens, {
    star: get('--sky-star'), moonLit: get('--moon-lit'), moonDark: get('--moon-dark'),
    cloud: get('--sky-cloud'), rain: get('--sky-rain'), flash: get('--sky-flash'),
  });
  // The cloud colour fully clear, for the soft edge (not black-transparent, which greys it).
  tokens.cloudClear = tokens.cloud.replace(/,\s*[\d.]+\)$/, ', 0)');
}

// ---------- Weather: what Open-Meteo says it is doing there now ----------

// WMO codes to what the layer draws (rain and snow per minute of sky, cloud count).
function weatherLayer(code) {
  if (!Number.isFinite(code)) return { clouds: 0 };
  if (code >= 95) return { clouds: 5, rain: 1, storm: true };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { clouds: 4, snow: code >= 75 || code === 86 ? 1 : 0.5 };
  if ([65, 67, 82].includes(code)) return { clouds: 5, rain: 1 };
  if ([61, 63, 66, 80, 81].includes(code)) return { clouds: 4, rain: 0.6 };
  if ([51, 53, 55, 56, 57].includes(code)) return { clouds: 4, rain: 0.25 };
  if ([45, 48].includes(code)) return { clouds: 2, haze: true };
  return { clouds: [0, 1, 2, 4][code] ?? 0 };
}

// ---------- State ----------

const scene = {
  sky: null, dark: 0, moon: null, weather: { clouds: 0 },
  drops: [], flakes: [], clouds: [], flash: 0, nextFlash: 0,
  parallax: { x: 0, y: 0, tx: 0, ty: 0 }, width: 0, height: 0,
};
let shownKey = '';
let running = false;
let last = 0;

// Stars at fixed places (a seeded sequence), so the night sky is the same each visit.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
let stars = [];

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  scene.width = window.innerWidth;
  scene.height = window.innerHeight;
  canvas.width = Math.round(scene.width * ratio);
  canvas.height = Math.round(scene.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const rand = seeded(7);
  stars = Array.from({ length: Math.min(140, Math.round((scene.width * scene.height) / 9000)) }, () => ({
    x: rand() * scene.width, y: rand() * scene.height * 0.75, r: 0.5 + rand() * 0.9, a: 0.45 + rand() * 0.55,
  }));
  seedWeather();
  draw();
}

function seedWeather() {
  const { width: w, height: h, weather } = scene;
  const rand = seeded(11);
  scene.clouds = Array.from({ length: weather.clouds }, (_, i) => ({
    x: rand() * w, y: 30 + (i / Math.max(1, weather.clouds)) * h * 0.45 + rand() * 40, size: 70 + rand() * 90, speed: 4 + rand() * 5,
  }));
  scene.drops = Array.from({ length: Math.round((weather.rain ?? 0) * (w * h) / 6000) }, () => ({
    x: rand() * w, y: rand() * h, len: 10 + rand() * 8, speed: 420 + rand() * 220,
  }));
  scene.flakes = Array.from({ length: Math.round((weather.snow ?? 0) * (w * h) / 14000) }, () => ({
    x: rand() * w, y: rand() * h, r: 1 + rand() * 1.6, speed: 25 + rand() * 30, sway: rand() * Math.PI * 2,
  }));
}

// ---------- Drawing ----------

function drawMoon(px, py) {
  const { moon } = scene;
  const r = 15;
  const x = scene.width * 0.84 + px;
  const y = Math.min(110, scene.height * 0.16) + py;
  ctx.save();
  ctx.globalAlpha = Math.min(1, scene.dark * 1.4);
  ctx.fillStyle = tokens.moonDark;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // The lit part: a half disc on the side the sun lights, and an ellipse
  // whose width follows how full the Moon is (waxing lit on the right, as seen from the north).
  const waxing = moon.phase < 0.5;
  const w = Math.abs(1 - 2 * moon.lit) * r;
  ctx.fillStyle = tokens.moonLit;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
  ctx.ellipse(x, y, w, r, 0, Math.PI / 2, -Math.PI / 2, moon.lit > 0.5 ? !waxing : waxing);
  ctx.fill();
  ctx.restore();
}

function draw() {
  if (!tokens || !scene.width) return;
  const { width: w, height: h, parallax, weather } = scene;
  ctx.clearRect(0, 0, w, h);
  const moving = !reduced.matches;
  const px = moving ? parallax.x : 0;
  const py = moving ? parallax.y : 0;
  const cloudy = Math.min(1, weather.clouds / 5);

  // Stars, fainter behind cloud; furthest away, so they move least.
  const starAlpha = scene.dark * (1 - cloudy * 0.8);
  if (starAlpha > 0.02) {
    ctx.fillStyle = tokens.star;
    for (const s of stars) {
      ctx.globalAlpha = s.a * starAlpha;
      ctx.beginPath();
      ctx.arc(s.x + px * 0.4, s.y + py * 0.4, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (scene.moon && scene.dark > 0.1) drawMoon(px * 0.6, py * 0.6);

  // Cloud: soft discs, nearer than the Moon.
  for (const c of scene.clouds) {
    for (const [dx, dy, k] of [[0, 0, 1], [c.size * 0.55, 8, 0.75], [-c.size * 0.5, 10, 0.7]]) {
      const x = c.x + dx + px;
      const y = c.y + dy + py;
      const g = ctx.createRadialGradient(x, y, 0, x, y, c.size * k);
      g.addColorStop(0, tokens.cloud);
      g.addColorStop(1, tokens.cloudClear);
      ctx.fillStyle = g;
      ctx.fillRect(x - c.size, y - c.size, c.size * 2, c.size * 2);
    }
  }
  if (weather.haze) {
    const g = ctx.createLinearGradient(0, h * 0.5, 0, h);
    g.addColorStop(0, tokens.cloudClear);
    g.addColorStop(1, tokens.cloud);
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
  }
  if (moving) {
    ctx.strokeStyle = tokens.rain;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of scene.drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
    }
    ctx.stroke();
    ctx.fillStyle = tokens.rain;
    for (const f of scene.flakes) {
      ctx.beginPath();
      ctx.arc(f.x + Math.sin(f.sway) * 6, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (scene.flash > 0) {
    ctx.globalAlpha = scene.flash;
    ctx.fillStyle = tokens.flash;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}

// Moves what moves: weather and the parallax easing towards the pointer or tilt.
function step(dt, now) {
  const { width: w, height: h, parallax } = scene;
  parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 6);
  parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 6);
  for (const c of scene.clouds) c.x = c.x > w + c.size * 1.5 ? -c.size * 1.5 : c.x + c.speed * dt;
  for (const d of scene.drops) {
    d.y += d.speed * dt;
    d.x -= d.speed * dt * 0.18;
    // Back to the top, shifted by the slant so the rain stays even across the width.
    if (d.y > h) Object.assign(d, { y: -d.len, x: Math.random() * (w + h * 0.18) });
  }
  for (const f of scene.flakes) {
    f.y += f.speed * dt;
    f.sway += dt;
    if (f.y > h) f.y = -4;
  }
  // A thunderstorm's lightning: a soft flash every 9 to 20 seconds, far below
  // three a second, and faint enough that text keeps its contrast (DESIGN.md).
  if (scene.weather.storm) {
    if (!scene.nextFlash) scene.nextFlash = now + 9000 + Math.random() * 11000;
    if (now >= scene.nextFlash) {
      scene.flash = 1;
      scene.nextFlash = now + 9000 + Math.random() * 11000;
    }
  }
  scene.flash = Math.max(0, scene.flash - dt * 2.5);
}

const settled = () => Math.abs(scene.parallax.tx - scene.parallax.x) < 0.05 && Math.abs(scene.parallax.ty - scene.parallax.y) < 0.05;
const weatherMoves = () => scene.clouds.length || scene.drops.length || scene.flakes.length || scene.weather.storm;

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (now - last < FRAME_MS) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  step(dt, now);
  draw();
  if (!weatherMoves() && settled() && scene.flash === 0) stop();
}

// Runs only while there is something to move, the page is visible and motion is allowed.
function start() {
  if (running || reduced.matches || document.hidden) return;
  running = true;
  skyEl.dataset.animating = 'true';
  last = 0;
  requestAnimationFrame(frame);
}
function stop() {
  running = false;
  skyEl.dataset.animating = 'false';
}
function wake() {
  if (reduced.matches || document.hidden) {
    stop();
    draw();
  } else if (weatherMoves() || !settled()) start();
  else draw();
}

// ---------- Inputs ----------

function setTarget(fx, fy) {
  if (reduced.matches) return;
  scene.parallax.tx = Math.max(-1, Math.min(1, fx)) * PARALLAX_PX;
  scene.parallax.ty = Math.max(-1, Math.min(1, fy)) * PARALLAX_PX;
  wake();
}

export function setupSky() {
  readTokens();
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', wake);
  reduced.addEventListener('change', wake);
  // The theme's colours: the system setting, or the page's own choice on <html>.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTokens(); shownKey = ''; draw(); });
  new MutationObserver(() => { readTokens(); shownKey = ''; draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // Parallax: the pointer on a desktop, the tilt of a phone (where the browser gives it without asking).
  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => setTarget(e.clientX / scene.width * 2 - 1, e.clientY / scene.height * 2 - 1), { passive: true });
  }
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma === null || e.beta === null) return;
    setTarget(e.gamma / 45, (e.beta - 45) / 45);
  }, { passive: true });
}

// Called on every tick: `home` is the viewer's city (or null), `ms` the time shown,
// `current` Open-Meteo's reading there (or null).
export function updateSky(home, ms, current) {
  if (!tokens) return;
  const minute = Math.floor(ms / 60000);
  const code = current?.weather_code;
  const key = `${minute}|${home?.lat}|${home?.lon}|${code}|${tokens.day[0]}`;
  if (key === shownKey) return;
  shownKey = key;

  const sky = skyAt(home, ms);
  const [top, bottom] = [0, 1].map((i) => mix(tokens[sky.from][i], tokens[sky.to][i], sky.k));
  skyEl.style.setProperty('--sky-top', top);
  skyEl.style.setProperty('--sky-bottom', bottom);
  // Named as the cards name it: dawn and dusk are the whole hour either side of sunrise and sunset.
  skyEl.dataset.phase = sky.from === sky.to ? sky.from : [sky.from, sky.to].includes('dawn') ? 'dawn' : 'dusk';
  scene.dark = DARK[sky.from] + (DARK[sky.to] - DARK[sky.from]) * sky.k;

  // The Moon: its phase now; shown where it is above the horizon (anywhere, without a position).
  const { lit, phase } = moonPhase(ms);
  const up = home ? moonHeight(ms, home.lat, home.lon) > 0 : true;
  scene.moon = up ? { lit, phase } : null;
  skyEl.dataset.moon = up ? lit.toFixed(2) : 'bawah ufuk';

  const weather = weatherLayer(code);
  if (JSON.stringify(weather) !== JSON.stringify(scene.weather)) {
    scene.weather = weather;
    scene.nextFlash = 0;
    seedWeather();
  }
  skyEl.dataset.weather = weather.storm ? 'ribut' : weather.rain ? 'hujan' : weather.snow ? 'salji' : weather.haze ? 'kabus' : weather.clouds ? 'awan' : 'cerah';
  wake();
}
