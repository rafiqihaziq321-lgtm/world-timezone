// The clocks as a picture to send (WhatsApp, Slack): each city's name, time,
// date and time of day, drawn on a canvas in the cards' colours. Shared
// through the phone's share sheet where there is one, else saved as a PNG.
// Loaded the first time the button is pressed.

import { PHASES, cityPhase, formatClock, formatUtcOffset, utcOffsetMinutes } from './time.js';

// The cards' gradients (style.css), and the text on each.
const COLOURS = {
  dawn: ['#fda4af', '#fde68a', '#7c2d12'],
  day: ['#7dd3fc', '#e0f2fe', '#0c4a6e'],
  dusk: ['#5b21b6', '#c2410c', '#fff7ed'],
  night: ['#0b1026', '#312e81', '#e0e7ff'],
};
const WIDTH = 1080;
const ROW = 132;
const FONT = '"Manrope", system-ui, sans-serif';

export async function drawClocks(state, ms) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = 120 + state.cities.length * ROW + 72;
  const g = canvas.getContext('2d');
  g.fillStyle = '#060b24';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffffff';
  g.font = `800 44px ${FONT}`;
  g.fillText('Jam Dunia', 48, 76);
  state.cities.forEach((city, i) => {
    const top = 120 + i * ROW;
    const phase = cityPhase(city, ms);
    const [from, to, text] = COLOURS[phase];
    const fill = g.createLinearGradient(0, top, WIDTH, top + ROW);
    fill.addColorStop(0, from);
    fill.addColorStop(1, to);
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(32, top, WIDTH - 64, ROW - 16, 24);
    g.fill();
    g.fillStyle = text;
    g.font = `800 38px ${FONT}`;
    g.fillText(city.label ? `${city.label} · ${city.name}` : city.name, 64, top + 52);
    g.font = `500 26px ${FONT}`;
    const day = new Date(ms).toLocaleDateString('ms-MY', { timeZone: city.zone, weekday: 'long', day: 'numeric', month: 'long' });
    g.fillText(`${day} · ${PHASES[phase].name} · ${formatUtcOffset(utcOffsetMinutes(city.zone, new Date(ms)))}`, 64, top + 92);
    g.font = `800 64px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(formatClock(state, city.zone, ms), WIDTH - 64, top + 82);
    g.textAlign = 'left';
  });
  g.fillStyle = '#94a3b8';
  g.font = `500 24px ${FONT}`;
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
