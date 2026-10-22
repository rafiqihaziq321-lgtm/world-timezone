// Renders the app icons (icons/*.png) and the link preview image (og-image.png)
// with Playwright. Run after changing the brand mark or the hero design:
//   node scripts/build-assets.mjs        (CHROMIUM_PATH=... to use a preinstalled Chromium)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const mark = readFileSync(`${root}icons/icon.svg`, 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// markRatio: share of the square the mark fills. Maskable icons keep it inside
// the central safe zone because launchers crop them to circles or squircles.
const icons = [
  ['icons/icon-192.png', 192, 0.72],
  ['icons/icon-512.png', 512, 0.72],
  ['icons/icon-maskable-512.png', 512, 0.56],
  ['icons/apple-touch-icon.png', 180, 0.68],
];
for (const [file, size, markRatio] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#060b24">
    <div style="width:${size * markRatio}px;height:${size * markRatio}px">${mark.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await page.screenshot({ path: `${root}${file}` });
  await page.close();
  console.log(file);
}

// Link preview: the hero without anything time-specific or interactive, its
// lede replaced by what the site offers. Served over http: browsers do not
// load the page's JavaScript modules from file://.
const PORT = 4174;
const server = spawn(process.execPath, [`${root}scripts/serve.mjs`, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.once('data', resolve);
  server.once('exit', (code) => reject(new Error(`serve.mjs exited with code ${code}`)));
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await page.goto(`http://localhost:${PORT}/index.html`);
await page.addStyleTag({ content: `
  .site-nav, .notices, #time-control, .hero-clock, .hero-actions, .hint, .globe-zoom, .hero-lede { display: none !important; }
  .hero { min-height: 630px; padding-block: 0; grid-template-areas: "copy globe"; }
  .og-features { margin: 28px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; font-size: 1.3rem; font-weight: 700; }
  .og-features li { display: flex; gap: 12px; align-items: center; }
` });
await page.evaluate(() => {
  const list = document.createElement('ul');
  list.className = 'og-features';
  for (const text of ['🌍 Jam dunia & perancang mesyuarat', '🇲🇾 Cuaca, amaran MET & waktu solat', '🗺️ Peta 3D Malaysia & kualiti udara']) {
    list.append(Object.assign(document.createElement('li'), { textContent: text }));
  }
  document.querySelector('.hero-lede').after(list);
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.screenshot({ path: `${root}og-image.png` });
console.log('og-image.png');
await browser.close();
server.kill();
