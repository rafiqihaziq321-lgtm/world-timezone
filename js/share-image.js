// The clocks as a picture to send (WhatsApp, Slack): each city's name, time,
// date and time of day, with the cards' sun strip. Shared through the phone's
// share sheet where there is one, else saved as a PNG.
// Loaded the first time the button is pressed.

import { daySegments } from './cards.js';
import { PHASES, cityPhase, formatClock, formatUtcOffset, utcOffsetMinutes } from './time.js';

// The light theme's colours and the sun strip's (style.css, DESIGN.md).
const INK = { page: '#f6faf9', row: '#ffffff', border: '#d5e0de', text: '#134e4a', muted: '#475569', night: '#1e3a5f', day: '#fde68a', edge: '#7b8b89', now: '#b45309' };
const ENDS = { night: ['night', 'night'], day: ['day', 'day'], dawn: ['night', 'day'], dusk: ['day', 'night'] };
const WIDTH = 1080;
const ROW = 132;
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif'; // drawn in 400 and 700, the two weights loaded

// The city's day, midnight to midnight, and a mark at the time shown.
function drawStrip(g, city, ms, x, y, w, h) {
  const { start, end, runs } = daySegments(city, ms);
  const at = (t) => x + ((t - start) / (end - start)) * w;
  for (const run of runs) {
    const fill = g.createLinearGradient(at(run.from), 0, at(run.to), 0);
    ENDS[run.phase].forEach((name, i) => fill.addColorStop(i, INK[name]));
    g.fillStyle = fill;
    g.fillRect(at(run.from), y, at(run.to) - at(run.from), h);
  }
  g.strokeStyle = INK.edge;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  g.fillStyle = INK.now;
  g.fillRect(at(ms) - 2, y - 6, 4, h + 12);
}

export async function drawClocks(state, ms) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = 120 + state.cities.length * ROW + 72;
  const g = canvas.getContext('2d');
  g.fillStyle = INK.page;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = INK.text;
  g.font = `700 44px ${FONT}`;
  g.fillText('Jam Dunia', 48, 76);
  state.cities.forEach((city, i) => {
    const top = 120 + i * ROW;
    const phase = cityPhase(city, ms);
    g.fillStyle = INK.row;
    g.strokeStyle = INK.border;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(32, top, WIDTH - 64, ROW - 16, 24);
    g.fill();
    g.stroke();
    g.fillStyle = INK.text;
    g.font = `700 38px ${FONT}`;
    g.fillText(city.label ? `${city.label} · ${city.name}` : city.name, 64, top + 46);
    g.font = `400 26px ${FONT}`;
    g.fillStyle = INK.muted;
    const day = new Date(ms).toLocaleDateString('ms-MY', { timeZone: city.zone, weekday: 'long', day: 'numeric', month: 'long' });
    g.fillText(`${day} · ${PHASES[phase].name} · ${formatUtcOffset(utcOffsetMinutes(city.zone, new Date(ms)))}`, 64, top + 80);
    g.fillStyle = INK.text;
    g.font = `700 64px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(formatClock(state, city.zone, ms), WIDTH - 64, top + 72);
    g.textAlign = 'left';
    drawStrip(g, city, ms, 64, top + 92, WIDTH - 128, 10);
  });
  g.fillStyle = INK.muted;
  g.font = `400 24px ${FONT}`;
  g.fillText(`Dari Jam Dunia, ${new Date(ms).toLocaleString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: state.hour24 ? 'h23' : 'h12' })} waktu anda`, 48, canvas.height - 32);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Kanvas tidak dapat dijadikan PNG'))), 'image/png');
  });
}

// Shares or saves the picture; resolves with a line saying which.
export async function shareClocks(state, ms) {
  const blob = await drawClocks(state, ms);
  const stamp = new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = new File([blob], `jam-dunia-${stamp}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Jam Dunia' });
      return 'Imej dikongsi.';
    } catch (err) {
      if (err.name === 'AbortError') return 'Perkongsian dibatalkan.';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'Imej dimuat turun.';
}
