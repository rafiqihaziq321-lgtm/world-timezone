'use strict';

// IANA zones carry no coordinates, so the globe only knows these cities.
// Each name matches its zone's city so a globe click and its card agree.
const GLOBE_CITIES = [
  { name: 'Kuala Lumpur', zone: 'Asia/Kuala_Lumpur', lon: 101.69, lat: 3.14 },
  { name: 'Singapore', zone: 'Asia/Singapore', lon: 103.82, lat: 1.35 },
  { name: 'Jakarta', zone: 'Asia/Jakarta', lon: 106.85, lat: -6.21 },
  { name: 'Bangkok', zone: 'Asia/Bangkok', lon: 100.5, lat: 13.76 },
  { name: 'Hong Kong', zone: 'Asia/Hong_Kong', lon: 114.17, lat: 22.32 },
  { name: 'Shanghai', zone: 'Asia/Shanghai', lon: 121.47, lat: 31.23 },
  { name: 'Seoul', zone: 'Asia/Seoul', lon: 126.98, lat: 37.57 },
  { name: 'Tokyo', zone: 'Asia/Tokyo', lon: 139.69, lat: 35.69 },
  { name: 'Kolkata', zone: 'Asia/Kolkata', lon: 88.36, lat: 22.57 },
  { name: 'Dubai', zone: 'Asia/Dubai', lon: 55.27, lat: 25.2 },
  { name: 'Riyadh', zone: 'Asia/Riyadh', lon: 46.68, lat: 24.71 },
  { name: 'Istanbul', zone: 'Europe/Istanbul', lon: 28.98, lat: 41.01 },
  { name: 'Moscow', zone: 'Europe/Moscow', lon: 37.62, lat: 55.76 },
  { name: 'Cairo', zone: 'Africa/Cairo', lon: 31.24, lat: 30.04 },
  { name: 'Lagos', zone: 'Africa/Lagos', lon: 3.38, lat: 6.52 },
  { name: 'Johannesburg', zone: 'Africa/Johannesburg', lon: 28.05, lat: -26.2 },
  { name: 'Paris', zone: 'Europe/Paris', lon: 2.35, lat: 48.86 },
  { name: 'London', zone: 'Europe/London', lon: -0.13, lat: 51.51 },
  { name: 'New York', zone: 'America/New_York', lon: -74.01, lat: 40.71 },
  { name: 'Chicago', zone: 'America/Chicago', lon: -87.63, lat: 41.88 },
  { name: 'Los Angeles', zone: 'America/Los_Angeles', lon: -118.24, lat: 34.05 },
  { name: 'Mexico City', zone: 'America/Mexico_City', lon: -99.13, lat: 19.43 },
  { name: 'Sao Paulo', zone: 'America/Sao_Paulo', lon: -46.63, lat: -23.55 },
  { name: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires', lon: -58.38, lat: -34.6 },
  { name: 'Sydney', zone: 'Australia/Sydney', lon: 151.21, lat: -33.87 },
  { name: 'Auckland', zone: 'Pacific/Auckland', lon: 174.76, lat: -36.85 },
  { name: 'Honolulu', zone: 'Pacific/Honolulu', lon: -157.86, lat: 21.31 },
];

const GLOBE_COLORS = {
  ocean: '#13294b',
  graticule: 'rgba(255, 255, 255, 0.08)',
  land: '#3d6a8a',
  night: 'rgba(2, 6, 23, 0.35)',
  outline: 'rgba(255, 255, 255, 0.25)',
  cityDay: '#fbbf24',
  cityNight: '#93c5fd',
  label: '#f8fafc',
  labelHalo: 'rgba(2, 6, 23, 0.85)',
};

// Point on Earth where the sun is directly overhead. Low-precision formula
// (declination + equation of time); accurate to about a degree, which is
// plenty for shading a 110m-resolution globe.
function subsolarPoint(date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 864e5;
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const b = (2 * Math.PI / 365) * (dayOfYear - 81);
  const equationOfTimeMin = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -15 * (utcHours - 12 + equationOfTimeMin / 60);
  lon = ((lon + 540) % 360) - 180;
  return [lon, declination];
}

// Draws a rotatable globe into `canvas`. `onCityClick(zone)` fires when a city
// dot is clicked; `isSelected(zone)` and `isHour24()` are read every frame so
// the globe always reflects the app's current state without being told.
function createGlobe(canvas, { onCityClick, isSelected, isHour24 }) {
  const ctx = canvas.getContext('2d');
  const land = topojson.feature(WORLD_LAND_110M, WORLD_LAND_110M.objects.land);
  const graticule = d3.geoGraticule10();
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
  const path = d3.geoPath(projection, ctx);
  const nightCircle = d3.geoCircle().precision(2);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUTO_ROTATE_DEG_PER_MS = 0.006;
  const IDLE_BEFORE_AUTO_ROTATE_MS = 3000;
  const FOCUS_DURATION_MS = 800;

  let size = 0;
  let rotation = [-101.69, -10]; // start centred near Kuala Lumpur
  let drag = null;
  let focusAnim = null;
  let autoRotateAfter = 0;
  let lastFrame = performance.now();
  let hitTargets = [];
  const formatters = new Map();

  function timeLabel(zone, now) {
    const hour24 = isHour24();
    const key = `${zone}|${hour24}`;
    let fmt = formatters.get(key);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('ms-MY', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: hour24 ? 'h23' : 'h12',
      });
      formatters.set(key, fmt);
    }
    return fmt.format(now);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    size = canvas.clientWidth;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    projection.translate([size / 2, size / 2]).scale(size / 2 - 4);
  }

  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function draw(now) {
    projection.rotate(rotation);
    ctx.clearRect(0, 0, size, size);

    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = GLOBE_COLORS.ocean; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = GLOBE_COLORS.graticule; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = GLOBE_COLORS.land; ctx.fill();

    // Night = everything more than 90° from the subsolar point. A second,
    // smaller circle darkens the deep-night side beyond civil twilight (−6°).
    const sun = subsolarPoint(now);
    const antiSun = [sun[0] + 180, -sun[1]];
    for (const radius of [90, 84]) {
      ctx.beginPath(); path(nightCircle.center(antiSun).radius(radius)()); ctx.fillStyle = GLOBE_COLORS.night; ctx.fill();
    }

    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = GLOBE_COLORS.outline; ctx.lineWidth = 1.5; ctx.stroke();

    // Selected cities first so their labels win when labels collide.
    const viewCenter = [-rotation[0], -rotation[1]];
    const cities = [...GLOBE_CITIES].sort((a, b) => isSelected(b.zone) - isSelected(a.zone));
    const placedLabels = [];
    hitTargets = [];
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (const city of cities) {
      const coords = [city.lon, city.lat];
      if (d3.geoDistance(coords, viewCenter) > Math.PI / 2 - 0.05) continue;
      const [x, y] = projection(coords);
      const selected = isSelected(city.zone);
      const isDay = d3.geoDistance(coords, sun) < Math.PI / 2;
      hitTargets.push({ city, x, y });

      ctx.beginPath();
      ctx.arc(x, y, selected ? 4.5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = isDay ? GLOBE_COLORS.cityDay : GLOBE_COLORS.cityNight;
      ctx.fill();
      if (selected) { ctx.strokeStyle = GLOBE_COLORS.label; ctx.lineWidth = 1.5; ctx.stroke(); }

      const text = `${city.name} ${timeLabel(city.zone, now)}`;
      const w = ctx.measureText(text).width;
      const labelX = x + 8 + w > size ? x - 8 - w : x + 8;
      const box = { x: labelX - 2, y: y - 8, w: w + 4, h: 16 };
      if (placedLabels.some((p) => boxesOverlap(p, box))) continue;
      placedLabels.push(box);
      ctx.strokeStyle = GLOBE_COLORS.labelHalo; ctx.lineWidth = 3; ctx.strokeText(text, labelX, y);
      ctx.fillStyle = GLOBE_COLORS.label; ctx.fillText(text, labelX, y);
    }
  }

  function easeInOut(k) {
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }

  function frame(t) {
    const dt = Math.min(t - lastFrame, 100);
    lastFrame = t;
    if (focusAnim) {
      const k = Math.min((t - focusAnim.start) / FOCUS_DURATION_MS, 1);
      const [lon, lat] = focusAnim.interpolate(easeInOut(k));
      rotation = [-lon, -lat];
      if (k === 1) focusAnim = null;
    } else if (!drag && !reduceMotion && t > autoRotateAfter) {
      rotation = [rotation[0] + dt * AUTO_ROTATE_DEG_PER_MS, rotation[1]];
    }
    draw(new Date());
    requestAnimationFrame(frame);
  }

  function cityAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDist = 12;
    for (const target of hitTargets) {
      const d = Math.hypot(target.x - x, target.y - y);
      if (d < bestDist) { best = target.city; bestDist = d; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    focusAnim = null;
    drag = { x: e.clientX, y: e.clientY, rotation: rotation.slice(), moved: false };
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      canvas.style.cursor = cityAt(e) ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    const degPerPx = 57.3 / projection.scale();
    rotation = [
      drag.rotation[0] + dx * degPerPx,
      Math.max(-90, Math.min(90, drag.rotation[1] - dy * degPerPx)),
    ];
  });

  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      const city = cityAt(e);
      if (city) onCityClick(city.zone);
    }
    drag = null;
    autoRotateAfter = performance.now() + IDLE_BEFORE_AUTO_ROTATE_MS;
    canvas.style.cursor = cityAt(e) ? 'pointer' : 'grab';
  });

  canvas.addEventListener('pointercancel', () => {
    drag = null;
    autoRotateAfter = performance.now() + IDLE_BEFORE_AUTO_ROTATE_MS;
  });

  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(frame);

  return {
    hasZone(zone) {
      return GLOBE_CITIES.some((c) => c.zone === zone);
    },
    // Smoothly rotates the globe to centre on `zone`'s city, if it has one.
    focusZone(zone) {
      const city = GLOBE_CITIES.find((c) => c.zone === zone);
      if (!city) return;
      const start = performance.now();
      focusAnim = { start, interpolate: d3.geoInterpolate([-rotation[0], -rotation[1]], [city.lon, city.lat]) };
      autoRotateAfter = start + FOCUS_DURATION_MS + IDLE_BEFORE_AUTO_ROTATE_MS;
    },
  };
}
