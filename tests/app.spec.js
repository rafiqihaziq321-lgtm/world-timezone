// @ts-check
const path = require('path');
const { test: base, expect } = require('@playwright/test');

const APP_URL = `file://${path.resolve(__dirname, '..', 'index.html')}`;
const STORAGE_KEY = 'world-timezone:v1';
// 22:00:07 UTC = 06:00:07 Wed in Kuala Lumpur (London on BST, New York on EDT).
const FIXED_NOW = new Date('2026-10-13T22:00:07Z');

// Every test also fails if the page logs an error or warning.
const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on('pageerror', (err) => problems.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') problems.push(msg.text());
    });
    await use(page);
    expect(problems).toEqual([]);
  },
});

async function openApp(page, stored, query = '') {
  if (stored) {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(stored)]);
  }
  await page.clock.install({ time: FIXED_NOW });
  await page.goto(APP_URL + query);
  await page.clock.runFor(1100);
}

const storedZones = async (page) => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).zones;

const card = (page, zone) => page.locator(`.card[data-zone="${zone}"]`);
const cardZones = (page) => page.locator('.card').evaluateAll((cards) => cards.map((c) => c.dataset.zone));

async function addCity(page, query) {
  await page.fill('#zone-input', query);
  await page.click('#add-form button[type="submit"]');
  await page.clock.runFor(1100);
}

test.describe('kad jam', () => {
  test('papar bandar lalai dengan masa, UTC, fasa dan beza jam yang betul', async ({ page }) => {
    await openApp(page);
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);

    const expected = [
      ['Asia/Kuala_Lumpur', '06:00', 'UTC+8', 'dawn', 'Sama dengan waktu anda'],
      ['Europe/London', '23:00', 'UTC+1', 'night', '−7j dari waktu anda'],
      ['America/New_York', '18:00', 'UTC−4', 'dusk', '−12j dari waktu anda'],
      ['Asia/Tokyo', '07:00', 'UTC+9', 'day', '+1j dari waktu anda'],
    ];
    for (const [zone, hhmm, utc, phase, diff] of expected) {
      const c = card(page, zone);
      await expect(c.locator('.time')).toHaveText(new RegExp(`^${hhmm}:\\d\\d$`));
      await expect(c.locator('.utc')).toHaveText(utc);
      await expect(c).toHaveAttribute('data-phase', phase);
      await expect(c.locator('.diff')).toHaveText(diff);
    }
  });

  test('jarum jam analog menunjuk masa yang betul', async ({ page }) => {
    await openApp(page);
    const kl = card(page, 'Asia/Kuala_Lumpur');
    await expect(kl.locator('.hand.hour')).toHaveAttribute('transform', 'rotate(180 50 50)'); // 6 o'clock
    await expect(kl.locator('.hand.second')).toHaveAttribute('transform', /^rotate\((42|48|54) 50 50\)$/);
  });
});

test.describe('carian bandar', () => {
  test('tambah ikut nama (tak kira huruf besar), nama moden dan ID IANA', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'paris');
    await addCity(page, 'Kolkata'); // Chromium lists it as Asia/Calcutta
    await addCity(page, 'Asia/Seoul');
    expect(await cardZones(page)).toEqual(expect.arrayContaining(['Europe/Paris', 'Asia/Kolkata', 'Asia/Seoul']));
    await expect(card(page, 'Asia/Kolkata').locator('.utc')).toHaveText('UTC+5:30');
    await expect(card(page, 'Asia/Kolkata').locator('.diff')).toHaveText('−2j 30m dari waktu anda');
  });

  test('tunjuk ralat untuk bandar berganda atau tidak wujud', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'Tokyo');
    await expect(page.locator('#form-error')).toHaveText('Tokyo sudah ada dalam senarai.');
    await addCity(page, 'Atlantis');
    await expect(page.locator('#form-error')).toHaveText('Zon waktu "Atlantis" tidak dijumpai.');
    expect(await cardZones(page)).toHaveLength(4);
  });

  test('buang kad', async ({ page }) => {
    await openApp(page);
    await card(page, 'Asia/Tokyo').locator('.remove').click();
    await expect(card(page, 'Asia/Tokyo')).toHaveCount(0);
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York']);
  });
});

test.describe('simpanan', () => {
  test('senarai, format 12 jam dan tema kekal selepas reload; masa dipilih tidak disimpan', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'Paris');
    await card(page, 'Asia/Tokyo').locator('.remove').click();
    await expect(card(page, 'Asia/Tokyo')).toHaveCount(0);
    await page.uncheck('#format24');
    await page.click('#theme-toggle');
    const theme = await page.getAttribute('html', 'data-theme');
    await page.locator('#time-slider').fill('8');

    const stored = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
    expect(stored).not.toHaveProperty('viewTime');

    await page.reload();
    await page.clock.runFor(1100);
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Europe/Paris']);
    await expect(page.locator('#format24')).not.toBeChecked();
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText(/PG$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', /** @type {string} */ (theme));
    await expect(page.locator('#time-label')).toHaveText('Sekarang');
  });
});

test.describe('pengiraan masa', () => {
  test('offset UTC ikut DST', async ({ page }) => {
    await openApp(page);
    const offsets = await page.evaluate(() => [
      utcOffsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z')),
      utcOffsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z')),
      utcOffsetMinutes('America/New_York', new Date('2026-03-08T06:59:00Z')), // 01:59 EST
      utcOffsetMinutes('America/New_York', new Date('2026-03-08T07:00:00Z')), // 03:00 EDT
      utcOffsetMinutes('Asia/Kolkata', new Date('2026-06-01T00:00:00Z')),
    ]);
    expect(offsets).toEqual([0, 60, -300, -240, 330]);
  });

  test('kedudukan matahari pada solstis', async ({ page }) => {
    await openApp(page);
    const [june, december] = await page.evaluate(() => [
      subsolarPoint(new Date('2026-06-21T12:00:00Z')),
      subsolarPoint(new Date('2026-12-21T00:00:00Z')),
    ]);
    expect(Math.abs(june[0])).toBeLessThan(2);
    expect(june[1]).toBeCloseTo(23.44, 0);
    expect(Math.abs(december[0])).toBeGreaterThan(177);
    expect(december[1]).toBeCloseTo(-23.44, 0);
  });
});

test.describe('penukar masa', () => {
  test('slider +9 jam mengubah semua kad, dan butang kembali ke sekarang', async ({ page }) => {
    await openApp(page);
    await page.locator('#time-slider').fill('36'); // 36 × 15 min
    await page.clock.runFor(1100);
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText('15:00:00');
    await expect(card(page, 'Europe/London').locator('.time')).toHaveText('08:00:00');
    await expect(card(page, 'America/New_York').locator('.time')).toHaveText('03:00:00');
    await expect(page.locator('#time-label')).toContainText('+9j dari sekarang');

    await page.click('#time-reset');
    await expect(page.locator('#time-label')).toHaveText('Sekarang');
    await expect(page.locator('#time-slider')).toHaveValue('0');
    await expect(page.locator('#time-reset')).toBeHidden();
  });

  test('butang main memajukan masa dan boleh dijeda', async ({ page }) => {
    await openApp(page);
    await page.click('#time-play');
    await page.clock.runFor(5000); // 72 min per second -> about +6h
    await expect(page.locator('#time-play')).toHaveText('⏸');
    const steps = Number(await page.locator('#time-slider').inputValue());
    expect(steps).toBeGreaterThanOrEqual(22);
    expect(steps).toBeLessThanOrEqual(26);

    await page.click('#time-play');
    await expect(page.locator('#time-play')).toHaveText('▶');
    const paused = await page.locator('#time-slider').inputValue();
    await page.clock.runFor(2000);
    await expect(page.locator('#time-slider')).toHaveValue(paused);
  });
});

test.describe('perancang mesyuarat', () => {
  const cases = [
    [['Asia/Kuala_Lumpur', 'Asia/Tokyo'], 'Waktu sesuai untuk semua (waktu anda): 09:00–16:00'],
    [['Asia/Kuala_Lumpur', 'Asia/Kolkata'], 'Waktu sesuai untuk semua (waktu anda): 12:00–17:00'],
    [['Asia/Kuala_Lumpur', 'Europe/London', 'Asia/Dubai'], 'Waktu sesuai untuk semua (waktu anda): 16:00–17:00'],
    [['Asia/Kuala_Lumpur', 'America/New_York', 'Asia/Tokyo'], 'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini.'],
  ];
  for (const [zones, summary] of cases) {
    test(`ringkasan untuk ${zones.join(' + ')}`, async ({ page }) => {
      await openApp(page, { zones, hour24: true });
      await expect(page.locator('#planner-summary')).toHaveText(summary);
    });
  }

  test('klik satu jam melompat ke masa itu', async ({ page }) => {
    await openApp(page);
    await page.click('#planner-table thead button[aria-label="Lihat masa 15:00 waktu anda"]');
    await page.clock.runFor(1100);
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText('15:00:00');
    await expect(page.locator('#time-slider')).toHaveValue('36');
  });
});

test.describe('glob', () => {
  // Where a city sits on screen once the globe is centred on Tokyo
  // (zoom 1, no intro animation under reduced motion).
  async function projectedFromTokyo(page, lonLat) {
    return page.evaluate((point) => {
      const canvas = document.getElementById('globe');
      const size = canvas.clientWidth;
      const projection = d3.geoOrthographic()
        .translate([size / 2, size / 2])
        .scale((size / 2) * 0.88)
        .rotate([-139.69, -35.69]);
      return projection(point);
    }, lonLat);
  }

  // Clicking the Tokyo card scrolls the page down to it, so bring the globe
  // back on screen before pointing at it.
  async function centreOnTokyo(page) {
    await card(page, 'Asia/Tokyo').locator('.city').click();
    await page.clock.runFor(1000);
    await page.locator('#globe').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // The globe stops drawing while off screen; wait until it is visible and
    // has drawn a few frames so its city hit-targets match the new rotation.
    await expect(page.locator('#globe')).toBeInViewport();
    await page.clock.runFor(100);
    const box = await page.locator('#globe').boundingBox();
    if (!box) throw new Error('globe canvas not rendered');
    return box;
  }

  test('klik kad memusatkan glob; klik bandar pada glob menambahnya', async ({ page }) => {
    await openApp(page);
    const box = await centreOnTokyo(page);
    const [x, y] = await projectedFromTokyo(page, [126.98, 37.57]); // Seoul
    await page.mouse.click(box.x + x, box.y + y);
    await page.clock.runFor(300);
    await expect(card(page, 'Asia/Seoul')).toHaveCount(1);

    await page.mouse.click(box.x + x, box.y + y); // already listed: no duplicate
    await page.clock.runFor(300);
    await expect(card(page, 'Asia/Seoul')).toHaveCount(1);
  });

  test('hover bandar menunjukkan tooltip', async ({ page }) => {
    await openApp(page);
    const box = await centreOnTokyo(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.clock.runFor(200);
    const tip = page.locator('.globe-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Tokyo');
    await expect(tip).toContainText('UTC+9');
    await expect(tip).toContainText('Dalam senarai anda');
  });

  test('butang zum mengubah glob', async ({ page }) => {
    await openApp(page);
    const snapshot = () => page.evaluate(() => document.getElementById('globe').toDataURL());
    const before = await snapshot();
    await page.click('#zoom-in');
    await page.clock.runFor(800);
    expect(await snapshot()).not.toBe(before);
  });
});

test.describe('tema dan paparan', () => {
  test('tema ikut sistem dan boleh ditukar', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page);
    const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    await expect(page.locator('#theme-toggle')).toHaveText('🌙');
    expect(await bg()).toBe('#eef2f7');
    await page.click('#theme-toggle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg()).toBe('#030712');
  });

  test('muat pada skrin telefon tanpa scroll mendatar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openApp(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const overflowing = await page.locator('.card .time').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
    expect(overflowing).toBe(0);
  });
});

test.describe('pautan kongsi', () => {
  const SHARED = '?bandar=Europe/Paris,Asia/Tokyo&masa=2026-10-14T07:00:00Z';

  test('buka pautan tanpa menimpa senarai sendiri, kemudian kembali', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Europe/London'], hour24: true }, SHARED);
    expect(await cardZones(page)).toEqual(['Europe/Paris', 'Asia/Tokyo']);
    await expect(card(page, 'Asia/Tokyo').locator('.time')).toHaveText('16:00:00');
    await expect(card(page, 'Europe/Paris').locator('.time')).toHaveText('09:00:00');
    await expect(page.locator('#share-banner')).toBeVisible();

    await addCity(page, 'Seoul'); // changes while viewing a link are not saved
    expect(await storedZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London']);

    await page.click('#share-exit');
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London']);
    await expect(page.locator('#share-banner')).toBeHidden();
    await expect(page.locator('#time-label')).toHaveText('Sekarang');
    expect(new URL(page.url()).search).toBe('');
  });

  test('simpan senarai dari pautan', async ({ page }) => {
    await openApp(page, undefined, SHARED);
    await page.click('#share-save');
    await expect(page.locator('#share-banner')).toBeHidden();
    expect(await storedZones(page)).toEqual(['Europe/Paris', 'Asia/Tokyo']);
    expect(new URL(page.url()).search).toBe('');

    await page.reload();
    await page.clock.runFor(1100);
    expect(await cardZones(page)).toEqual(['Europe/Paris', 'Asia/Tokyo']);
    await expect(page.locator('#share-banner')).toBeHidden();
  });

  test('bandar tidak sah dan pendua diabaikan', async ({ page }) => {
    await openApp(page, undefined, '?bandar=Atlantis,Asia/Tokyo,Asia/Tokyo');
    expect(await cardZones(page)).toEqual(['Asia/Tokyo']);
    await expect(page.locator('#share-banner')).toBeVisible();
  });

  test('pautan yang rosak sepenuhnya guna senarai sendiri', async ({ page }) => {
    await openApp(page, undefined, '?bandar=Atlantis&masa=bukan-tarikh');
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
    await expect(page.locator('#share-banner')).toBeHidden();
    await expect(page.locator('#time-label')).toHaveText('Sekarang');
  });

  test('butang kongsi menyalin pautan yang membuka paparan yang sama', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page);
    await page.locator('#time-slider').fill('36'); // 06:00 -> 15:00 KL = 07:00 UTC
    await page.click('#share');
    await expect(page.locator('#share-status')).toHaveText('Pautan disalin ke clipboard.');
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/\?bandar=Asia\/Kuala_Lumpur,Europe\/London,America\/New_York,Asia\/Tokyo&masa=2026-10-14T07:00:00Z$/);

    await page.goto(url);
    await page.clock.runFor(1100);
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText('15:00:00');
    await expect(page.locator('#share-banner')).toBeVisible();
  });

  test('papar pautan untuk disalin manual bila clipboard disekat', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    await openApp(page);
    await page.click('#share');
    await expect(page.locator('#share-status input')).toHaveValue(/\?bandar=Asia\/Kuala_Lumpur,/);
  });
});

test.describe('jimat bateri', () => {
  test('glob berhenti melukis bila di luar skrin dan sambung bila kelihatan', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.addInitScript(() => {
      const clearRect = CanvasRenderingContext2D.prototype.clearRect;
      window.globeDraws = 0;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.id === 'globe') window.globeDraws += 1;
        return clearRect.apply(this, args);
      };
    });
    await openApp(page);
    const drawsDuring = async (ms) => {
      await page.evaluate(() => { window.globeDraws = 0; });
      await page.clock.runFor(ms);
      return page.evaluate(() => window.globeDraws);
    };

    expect(await drawsDuring(1000)).toBeGreaterThan(30);

    await page.locator('#planner').scrollIntoViewIfNeeded();
    await expect(page.locator('#globe')).not.toBeInViewport();
    await page.clock.runFor(100); // let the in-flight frame finish
    expect(await drawsDuring(1000)).toBe(0);

    await page.locator('#globe').scrollIntoViewIfNeeded();
    await expect(page.locator('#globe')).toBeInViewport();
    expect(await drawsDuring(1000)).toBeGreaterThan(30);
  });
});
