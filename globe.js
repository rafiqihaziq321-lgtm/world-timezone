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

// Identity of a city in the user's list or on the globe: two cities can share
// a zone (Kuala Lumpur, Johor Bahru), so the name is part of it.
function cityKey(city) {
  return `${city.zone}~${city.name}`;
}

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
  arc: 'rgba(251, 191, 36, 0.9)',
  arcText: '#1c1917',
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


// Draws a rotatable, zoomable globe into `canvas`.
// Options (all read live, so the globe follows app state without being told):
//   onCityClick(city)               a city dot was clicked or tapped ({ name, zone, lat, lon })
//   getSelectedCities()             the user's list; cities with lat/lon get a dot, and the
//                                   first of those is the arc "home"
//   isHour24(), getNow()            label format and the instant to draw
//   describeCity(city, now)         -> { time, lines[] } for the tooltip
//   offsetBetween(from, to, now)    -> short label for the arc between two cities
function createGlobe(canvas, options) {
  const { onCityClick, getSelectedCities, isHour24, getNow, describeCity, offsetBetween } = options;
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
  const INTRO_DURATION_MS = 1100;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const RADIUS_RATIO = 0.88; // leave room around the sphere for the atmosphere glow

  const tip = document.createElement('div');
  tip.className = 'globe-tip';
  tip.hidden = true;
  canvas.parentElement.append(tip);

  let size = 0;
  let rotation = [-101.69, -10]; // start centred near Kuala Lumpur
  let zoom = 1;
  let targetZoom = 1;
  let drag = null;
  let pinch = null;
  let focusAnim = null;
  let autoRotateAfter = 0;
  let lastFrame = performance.now();
  const introStart = performance.now();
  let hitTargets = [];
  let tipCity = null;
  let tipKey = '';
  const pointers = new Map();
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
    projection.translate([size / 2, size / 2]);
  }

  function clampZoom(z) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function easeOutCubic(k) {
    return 1 - Math.pow(1 - k, 3);
  }

  function easeInOut(k) {
    return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }

  function pill(text, x, y, bg, fg) {
    const w = ctx.measureText(text).width + 10;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9, w, 18, 9);
    ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = fg; ctx.fillText(text, x - w / 2 + 5, y);
    return { x: x - w / 2, y: y - 9, w, h: 18 };
  }

  function draw(now, t) {
    const intro = reduceMotion ? 1 : easeOutCubic(Math.min(1, (t - introStart) / INTRO_DURATION_MS));
    const radius = (size / 2) * RADIUS_RATIO * zoom * (0.7 + 0.3 * intro);
    projection.rotate(rotation).scale(radius);
    const cx = size / 2;
    const cy = size / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = intro;

    // Atmosphere glow just outside the sphere.
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.98, cx, cy, radius * 1.12);
    glow.addColorStop(0, 'rgba(96, 165, 250, 0.45)');
    glow.addColorStop(1, 'rgba(96, 165, 250, 0)');
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.12, 0, 2 * Math.PI); ctx.fillStyle = glow; ctx.fill();

    // Ocean shaded from upper-left so the sphere reads as 3D.
    const ocean = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.35, radius * 0.1, cx, cy, radius);
    ocean.addColorStop(0, '#1f5f9e');
    ocean.addColorStop(1, '#0a1a36');
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = ocean; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = GLOBE_COLORS.graticule; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = GLOBE_COLORS.land; ctx.fill();

    // Night = everything more than 90° from the subsolar point. A second,
    // smaller circle darkens the deep-night side beyond civil twilight (−6°).
    const sun = subsolarPoint(now);
    const antiSun = [sun[0] + 180, -sun[1]];
    for (const r of [90, 84]) {
      ctx.beginPath(); path(nightCircle.center(antiSun).radius(r)()); ctx.fillStyle = GLOBE_COLORS.night; ctx.fill();
    }

    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = GLOBE_COLORS.outline; ctx.lineWidth = 1.5; ctx.stroke();

    const viewCenter = [-rotation[0], -rotation[1]];
    const onScreen = ([x, y]) => x >= 0 && x <= size && y >= 0 && y <= size;
    const isFacing = (coords) => d3.geoDistance(coords, viewCenter) < Math.PI / 2 - 0.05;

    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const placedLabels = [];

    // Arcs from the first listed city to each other listed city, with the
    // time difference at the midpoint. Dashes march unless motion is reduced.
    const selectedCities = getSelectedCities().filter((c) => c.lat !== null && c.lon !== null);
    const selectedKeys = new Set(selectedCities.map(cityKey));
    const [home, ...others] = selectedCities;
    if (home) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = reduceMotion ? 0 : -((t / 40) % 12);
      ctx.strokeStyle = GLOBE_COLORS.arc;
      ctx.lineWidth = 1.6;
      for (const other of others) {
        ctx.beginPath();
        path({ type: 'LineString', coordinates: [[home.lon, home.lat], [other.lon, other.lat]] });
        ctx.stroke();
      }
      ctx.restore();
      for (const other of others) {
        const mid = d3.geoInterpolate([home.lon, home.lat], [other.lon, other.lat])(0.5);
        if (!isFacing(mid)) continue;
        const [x, y] = projection(mid);
        if (!onScreen([x, y])) continue;
        placedLabels.push(pill(offsetBetween(home.zone, other.zone, now), x, y, GLOBE_COLORS.arc, GLOBE_COLORS.arcText));
      }
    }

    // The user's cities first so their labels win when labels collide, then
    // the built-in major cities that are not already in the list.
    const visible = [...selectedCities, ...GLOBE_CITIES.filter((c) => !selectedKeys.has(cityKey(c)))]
      .filter((city) => isFacing([city.lon, city.lat]))
      .map((city) => {
        const [x, y] = projection([city.lon, city.lat]);
        return { city, x, y, dotBox: { x: x - 5, y: y - 5, w: 10, h: 10 } };
      })
      .filter(({ x, y }) => onScreen([x, y]));
    hitTargets = visible;

    const pulse = reduceMotion ? 0 : (t % 1600) / 1600;
    for (const { city, x, y } of visible) {
      const selected = selectedKeys.has(cityKey(city));
      const isDay = d3.geoDistance([city.lon, city.lat], sun) < Math.PI / 2;
      const color = isDay ? GLOBE_COLORS.cityDay : GLOBE_COLORS.cityNight;
      if (selected && pulse) {
        ctx.beginPath();
        ctx.arc(x, y, 4.5 + 8 * pulse, 0, 2 * Math.PI);
        ctx.strokeStyle = color; ctx.globalAlpha = intro * (1 - pulse); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.globalAlpha = intro;
      }
      ctx.beginPath();
      ctx.arc(x, y, selected ? 4.5 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      if (selected) { ctx.strokeStyle = GLOBE_COLORS.label; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    // A label may not cover another label or another city's dot. Try right,
    // left, above and below the dot; if none fit, the label is skipped.
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    for (const target of visible) {
      const { city, x, y } = target;
      if (tipCity && cityKey(city) === cityKey(tipCity)) continue; // the tooltip already says it
      const text = `${city.name} ${timeLabel(city.zone, now)}`;
      const w = ctx.measureText(text).width;
      const candidates = [[x + 8, y], [x - 8 - w, y], [x - w / 2, y - 13], [x - w / 2, y + 13]];
      const spot = candidates.find(([lx, ly]) => {
        const box = { x: lx - 2, y: ly - 8, w: w + 4, h: 16 };
        if (box.x < 0 || box.x + box.w > size || box.y < 0 || box.y + box.h > size) return false;
        if (placedLabels.some((p) => boxesOverlap(p, box))) return false;
        return !visible.some((other) => other !== target && boxesOverlap(other.dotBox, box));
      });
      if (!spot) continue;
      const [lx, ly] = spot;
      placedLabels.push({ x: lx - 2, y: ly - 8, w: w + 4, h: 16 });
      ctx.strokeStyle = GLOBE_COLORS.labelHalo; ctx.lineWidth = 3; ctx.strokeText(text, lx, ly);
      ctx.fillStyle = GLOBE_COLORS.label; ctx.fillText(text, lx, ly);
    }
    ctx.globalAlpha = 1;

    updateTip(now, visible);
  }

  function updateTip(now, visible) {
    const target = tipCity && visible.find((v) => cityKey(v.city) === cityKey(tipCity));
    if (!target) {
      tip.hidden = true;
      return;
    }
    // Rebuild the content at most once per displayed second.
    const key = `${cityKey(tipCity)}|${Math.floor(now.getTime() / 1000)}|${isHour24()}`;
    if (key !== tipKey) {
      tipKey = key;
      const info = describeCity(tipCity, now);
      const title = document.createElement('strong');
      title.textContent = tipCity.name;
      const time = document.createElement('div');
      time.className = 'tip-time';
      time.textContent = info.time;
      const lines = info.lines.map((line) => {
        const div = document.createElement('div');
        div.textContent = line;
        return div;
      });
      tip.replaceChildren(title, time, ...lines);
    }
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    const wrapWidth = canvas.parentElement.clientWidth;
    const left = Math.max(half + 4, Math.min(wrapWidth - half - 4, canvas.offsetLeft + target.x));
    tip.style.left = `${left}px`;
    tip.style.top = `${canvas.offsetTop + target.y}px`;
  }

  // Only keep animating while the canvas is on screen; scrolling it out of
  // view stops the redraw loop (saves battery), scrolling back resumes it.
  let onScreen = true;
  let frameRequested = false;
  function requestFrame() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function frame(t) {
    frameRequested = false;
    const dt = Math.min(t - lastFrame, 100);
    lastFrame = t;
    zoom += (targetZoom - zoom) * Math.min(1, dt / 120);
    if (focusAnim) {
      const k = Math.min((t - focusAnim.start) / FOCUS_DURATION_MS, 1);
      const [lon, lat] = focusAnim.interpolate(easeInOut(k));
      rotation = [-lon, -lat];
      if (k === 1) focusAnim = null;
    } else if (!drag && !pinch && !tipCity && !reduceMotion && t > autoRotateAfter) {
      rotation = [rotation[0] + (dt * AUTO_ROTATE_DEG_PER_MS) / zoom, rotation[1]];
    }
    draw(getNow(), t);
    if (onScreen) requestFrame();
  }

  function cityAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDist = 14;
    for (const target of hitTargets) {
      const d = Math.hypot(target.x - x, target.y - y);
      if (d < bestDist) { best = target.city; bestDist = d; }
    }
    return best;
  }

  function pointerDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pauseAutoRotate() {
    autoRotateAfter = performance.now() + IDLE_BEFORE_AUTO_ROTATE_MS;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    focusAnim = null;
    if (pointers.size === 2) {
      drag = null;
      tipCity = null;
      pinch = { startDist: pointerDistance(), startZoom: targetZoom };
    } else if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, rotation: rotation.slice(), moved: false };
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      targetZoom = clampZoom(pinch.startZoom * (pointerDistance() / pinch.startDist));
      zoom = targetZoom;
      return;
    }
    if (!drag) {
      const city = cityAt(e);
      canvas.style.cursor = city ? 'pointer' : 'grab';
      if (e.pointerType === 'mouse') tipCity = city;
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      tipCity = null;
    }
    const degPerPx = 57.3 / projection.scale();
    rotation = [
      drag.rotation[0] + dx * degPerPx,
      Math.max(-90, Math.min(90, drag.rotation[1] - dy * degPerPx)),
    ];
  });

  function endPointer(e, cancelled) {
    if (!cancelled && drag && !drag.moved && pointers.size === 1) {
      const city = cityAt(e);
      tipCity = city;
      if (city) onCityClick(city);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    drag = null;
    pauseAutoRotate();
    canvas.style.cursor = cityAt(e) ? 'pointer' : 'grab';
  }

  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !drag) tipCity = null;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    targetZoom = clampZoom(targetZoom * Math.exp(-e.deltaY * 0.0015));
    pauseAutoRotate();
  }, { passive: false });

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    if (onScreen) requestFrame();
  }).observe(canvas);
  resize();
  requestFrame();

  return {
    // Smoothly rotates the globe to centre on `city`, if its position is known.
    focusCity(city) {
      if (city.lat === null || city.lon === null) return;
      const start = performance.now();
      focusAnim = { start, interpolate: d3.geoInterpolate([-rotation[0], -rotation[1]], [city.lon, city.lat]) };
      autoRotateAfter = start + FOCUS_DURATION_MS + IDLE_BEFORE_AUTO_ROTATE_MS;
    },
    zoomBy(factor) {
      targetZoom = clampZoom(targetZoom * factor);
      pauseAutoRotate();
    },
  };
}
