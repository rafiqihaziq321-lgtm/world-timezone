// @ts-check
const { test: base, expect } = require('@playwright/test');
const { deflateSync, crc32 } = require('node:zlib');
const { AxeBuilder } = require('@axe-core/playwright');

const APP_URL = 'index.html'; // relative to baseURL (the local test server)
const STORAGE_KEY = 'world-timezone:v1';
// 22:00:07 UTC = 06:00:07 Wed in Kuala Lumpur (London on BST, New York on EDT).
const FIXED_NOW = new Date('2026-10-13T22:00:07Z');

// Every test also fails if the page logs an error or warning, unless the test
// declares it with test.use({ expectedConsole: [/pattern/] }).
const test = base.extend({
  expectedConsole: [[], { option: true }],
  page: async ({ page, expectedConsole }, use) => {
    // Tests never reach the internet: every outside request gets an empty
    // answer unless the test routes it to its own mock (later routes win).
    await page.route((url) => url.hostname !== 'localhost', (route) => route.fulfill({
      json: [], headers: { 'Access-Control-Allow-Origin': '*' },
    }));
    const problems = [];
    page.on('pageerror', (err) => problems.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      // Playwright's own note when serviceWorkers: 'block' (the default here) stops registration.
      const tooling = /^Service Worker registration blocked by Playwright$/;
      // Chromium's software WebGL notes slow pixel reads made by the map.
      const gpuNote = /GL Driver Message \(OpenGL, Performance/;
      if (tooling.test(msg.text()) || gpuNote.test(msg.text())) return;
      if (!expectedConsole.some((pattern) => pattern.test(msg.text()))) problems.push(msg.text());
    });
    await use(page);
    expect(problems).toEqual([]);
  },
});

async function openApp(page, stored, query = '', now = FIXED_NOW) {
  if (stored) {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(stored)]);
  }
  // install() only sets the starting time; time would then keep flowing in
  // real time (slow browsers drift by seconds). Pause it so tests advance it
  // explicitly with runFor().
  await page.clock.install({ time: now.getTime() - 1000 });
  await page.clock.pauseAt(now);
  await page.goto(APP_URL + query);
  await page.clock.runFor(1100);
}

const storedState = async (page) => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
const storedCities = async (page) => JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).cities;
const storedZones = async (page) => (await storedCities(page)).map((c) => c.zone);

const card = (page, zone) => page.locator(`.card[data-zone="${zone}"]`);

// The globe's libraries load once its section nears the screen (or a card
// asks it to turn): scroll to it and wait until the globe has been made.
async function showGlobe(page) {
  await page.locator('#globe').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => typeof window.d3 !== 'undefined' && typeof window.WORLD_LAND_110M !== 'undefined');
  await page.waitForFunction(() => document.getElementById('globe').width !== 300); // sized by createGlobe
  await page.clock.runFor(300);
}
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
    await expect(kl.locator('.hand.second')).toHaveAttribute('transform', 'rotate(48 50 50)');
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
    await expect(page.locator('#form-error')).toHaveText('Bandar atau zon waktu “Atlantis” tidak dijumpai. Cuba nama bandar dalam bahasa Inggeris (cth. Tokyo) atau zon waktu seperti Asia/Tokyo.');
    expect(await cardZones(page)).toHaveLength(4);
  });

  test('buang kad, dan "Batal" mengembalikannya ke tempat asal', async ({ page }) => {
    await openApp(page);
    await card(page, 'Europe/London').locator('.remove').click();
    await expect(card(page, 'Europe/London')).toHaveCount(0);
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'America/New_York', 'Asia/Tokyo']);
    const undo = page.locator('#undo-bar');
    await expect(undo).toHaveText('London dibuang.Batal');
    await expect(undo.getByRole('button', { name: 'Batal' })).toBeFocused();
    await undo.getByRole('button', { name: 'Batal' }).click();
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
    expect(await storedZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo']);
    await expect(undo).toBeHidden();

    // Unanswered, the offer goes after a few seconds and the removal stands.
    await card(page, 'Asia/Tokyo').locator('.remove').click();
    await expect(undo).toBeVisible();
    await page.clock.runFor(9000);
    await expect(undo).toBeHidden();
    expect(await storedZones(page)).toEqual(['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York']);
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
  test('tukar jam (DST) dalam seminggu diberitahu pada kad bandar itu sahaja', async ({ page }) => {
    await openApp(page, undefined, '', new Date('2026-10-20T00:00:00Z')); // London changes on 25 October
    await expect(card(page, 'Europe/London').locator('.dst')).toHaveText('Ahad, 25 Okt: jam diundur dari 02:00 ke 01:00 (UTC+1 → UTC+0)');
    await expect(card(page, 'Europe/London').locator('.dst svg')).toHaveAttribute('data-glyph', 'clock');
    await expect(card(page, 'America/New_York').locator('.dst')).toBeHidden(); // 1 November: more than a week away
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.dst')).toBeHidden(); // no daylight saving
    const offsets = await page.evaluate(async () => {
      const { nextOffsetChange } = await import('./js/time.js');
      const c = nextOffsetChange('Australia/Sydney', Date.parse('2026-09-30T00:00:00Z'));
      return [new Date(c.at).toISOString(), c.from, c.to];
    });
    expect(offsets).toEqual(['2026-10-03T16:00:00.000Z', 600, 660]); // 02:00 becomes 03:00 in Sydney
  });

  test('offset UTC ikut DST', async ({ page }) => {
    await openApp(page);
    const offsets = await page.evaluate(async () => {
      const { utcOffsetMinutes } = await import('./js/time.js');
      return [
      utcOffsetMinutes('Europe/London', new Date('2026-01-15T12:00:00Z')),
      utcOffsetMinutes('Europe/London', new Date('2026-07-15T12:00:00Z')),
      utcOffsetMinutes('America/New_York', new Date('2026-03-08T06:59:00Z')), // 01:59 EST
      utcOffsetMinutes('America/New_York', new Date('2026-03-08T07:00:00Z')), // 03:00 EDT
      utcOffsetMinutes('Asia/Kolkata', new Date('2026-06-01T00:00:00Z')),
      ];
    });
    expect(offsets).toEqual([0, 60, -300, -240, 330]);
  });

  test('kedudukan matahari pada solstis', async ({ page }) => {
    await openApp(page);
    const [june, december] = await page.evaluate(async () => {
      const { subsolarPoint } = await import('./globe.js');
      return [subsolarPoint(new Date('2026-06-21T12:00:00Z')), subsolarPoint(new Date('2026-12-21T00:00:00Z'))];
    });
    expect(Math.abs(june[0])).toBeLessThan(2);
    expect(june[1]).toBeCloseTo(23.44, 0);
    expect(Math.abs(december[0])).toBeGreaterThan(177);
    expect(december[1]).toBeCloseTo(-23.44, 0);
  });
});

test.describe('kongsi imej', () => {
  test('tanpa skrin kongsi: PNG semua jam dimuat turun', async ({ page }) => {
    await page.addInitScript(() => { delete Navigator.prototype.canShare; delete Navigator.prototype.share; });
    await openApp(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Kongsi imej jam' }).click()]);
    expect(download.suggestedFilename()).toBe('jam-dunia-202610132200.png');
    const png = require('node:fs').readFileSync(await download.path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 120 + 4 * 132 + 72]); // a row per city
    await expect(page.locator('#share-image-status')).toHaveText('Imej dimuat turun.');
  });

  test('dengan skrin kongsi (telefon): fail PNG dihantar kepadanya', async ({ page }) => {
    await page.addInitScript(() => {
      window.sharedFiles = [];
      Navigator.prototype.canShare = () => true;
      Navigator.prototype.share = async ({ files }) => { window.sharedFiles.push(...files.map((f) => [f.name, f.type])); };
    });
    await openApp(page);
    await page.getByRole('button', { name: 'Kongsi imej jam' }).click();
    await expect(page.locator('#share-image-status')).toHaveText('Imej dikongsi.');
    expect(await page.evaluate(() => window.sharedFiles)).toEqual([['jam-dunia-202610132200.png', 'image/png']]);
  });
});

test.describe('kiraan detik', () => {
  test('modul yang lambat: borang sudah ada tetapi Tambah dimatikan; saiz bahagian tidak berubah', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/js/countdown.js', async (route) => { await held; await route.continue(); });
    await openApp(page);
    await page.locator('#countdowns').scrollIntoViewIfNeeded();
    const list = page.locator('.countdown-list');
    await expect(list).toHaveText('Memuatkan kiraan detik…');
    const add = page.locator('.countdown-form').getByRole('button', { name: 'Tambah' });
    await expect(add).toBeDisabled(); // no plain form submit (a page reload) before the module is here
    const height = () => page.locator('#countdowns').evaluate((e) => e.getBoundingClientRect().height);
    const before = await height();
    release();
    await expect(list).toHaveText('Belum ada kiraan. Tambah satu di atas.');
    await expect(add).toBeEnabled();
    expect(await height()).toBe(before);
  });

  test.describe('modul yang gagal', () => {
    test.use({ expectedConsole: [/Failed to load resource|countdown\.js/] }); // the browser reports the failed module

    // Retrying is not tested: Chromium does not fetch a failed module again (plan-001, D4).
    test('baris senarai berkata ia gagal; borang kekal di tempatnya', async ({ page }) => {
      await page.route('**/js/countdown.js', (route) => route.abort());
      await openApp(page);
      await page.locator('#countdowns').scrollIntoViewIfNeeded();
      const list = page.locator('.countdown-list');
      await expect(list).toContainText('Kiraan detik gagal dimuat.');
      await expect(list.getByRole('button', { name: 'Cuba lagi' })).toBeVisible();
      await expect(page.locator('.countdown-form')).toBeVisible();
      await expect(page.locator('.countdown-form').getByRole('button', { name: 'Tambah' })).toBeDisabled();
    });
  });

  test('tambah kiraan dalam waktu bandar lain: berdetik, disimpan, dan boleh dibuang', async ({ page }) => {
    await openApp(page); // 22:00:07 UTC, 13 October
    await page.locator('#countdowns').scrollIntoViewIfNeeded();
    const form = page.locator('.countdown-form');
    await expect(page.locator('.countdown-list .empty')).toHaveText('Belum ada kiraan. Tambah satu di atas.');
    await form.getByLabel('Nama acara').fill('Pelancaran');
    await form.getByLabel('Tarikh acara').fill('2026-10-15');
    await form.getByLabel('Masa acara').fill('09:00');
    await form.getByLabel('Zon waktu').selectOption('Asia/Tokyo'); // 09:00 in Tokyo = 00:00 UTC on the 15th
    await form.getByRole('button', { name: 'Tambah' }).click();
    const item = page.locator('.countdown');
    await expect(item.locator('h3')).toHaveText('Pelancaran');
    await expect(item.locator('.countdown-left')).toHaveText(/^1h 1j 59m [45]\ds lagi$/); // a second or two of typing
    await expect(item.locator('.local-status')).toHaveText('Khamis, 15 Oktober 2026 pada 09:00 di Tokyo · 08:00 waktu anda');
    await page.clock.runFor(60000); // it ticks
    await expect(item.locator('.countdown-left')).toHaveText(/^1h 1j 58m [45]\ds lagi$/);
    expect((await storedState(page)).countdowns).toEqual([{ title: 'Pelancaran', at: Date.parse('2026-10-15T00:00:00Z'), zone: 'Asia/Tokyo' }]);

    // Saved: there again in a new tab, and loaded before the section is scrolled to.
    const again = await page.context().newPage();
    await openApp(again);
    await expect(again.locator('.countdown h3')).toHaveText('Pelancaran');
    await again.close();

    await form.getByLabel('Nama acara').fill('Sudah lepas');
    await form.getByLabel('Tarikh acara').fill('2026-10-01');
    await form.getByRole('button', { name: 'Tambah' }).click();
    await expect(item.first().locator('.countdown-left')).toHaveText('Sudah berlalu'); // sorted first, being earliest
    await page.getByRole('button', { name: 'Buang kiraan Sudah lepas' }).click();
    await expect(item).toHaveCount(1);
    expect((await storedState(page)).countdowns).toHaveLength(1);
  });
});

test.describe('penukar masa', () => {
  test('taip masa: "3 petang Tokyo" menggerakkan semua jam ke masa itu', async ({ page }) => {
    await openApp(page); // 06:00 Wednesday in Kuala Lumpur
    const field = page.getByLabel('Taip masa');
    const status = page.locator('#time-type-status');
    await field.fill('3 petang Tokyo');
    await field.press('Enter');
    await expect(status).toHaveText('15:00 Rab, 14 Okt di Tokyo = 14:00 waktu anda');
    await expect(card(page, 'Asia/Tokyo').locator('.time')).toHaveText(/^15:00/);
    await expect(page.locator('#time-label')).toHaveText('+8j dari sekarang · Rab, 14 Okt, 14:00 waktu anda');

    await field.fill('9am New York esok'); // English, and tomorrow by New York's calendar (still Tuesday there)
    await field.press('Enter');
    await expect(status).toHaveText('09:00 Rab, 14 Okt di New York = 21:00 waktu anda');

    await field.fill('Tokyo'); // no time: explained, clocks stay
    await field.press('Enter');
    await expect(status).toHaveText('Tiada jam dalam teks itu. Cuba "3 petang Tokyo" atau "15:00 London".');
    await expect(page.locator('#time-label')).toContainText('21:00 waktu anda');

    await field.fill('7 pagi Lisbon'); // not a card: found in the city list; today there is still Tuesday
    await field.press('Enter');
    await expect(status).toHaveText('07:00 Sel, 13 Okt di Lisbon = 14:00 waktu anda');
    await field.fill('7 pagi Atlantis');
    await field.press('Enter');
    await expect(status).toHaveText('Bandar "atlantis" tidak dijumpai.');
  });

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
    await page.clock.runFor(1000); // 72 min per second; each frame re-renders every card, so keep it short
    await expect(page.locator('#time-play')).toHaveText('⏸');
    // One name, a pressed state screen readers announce, and no animation on the button.
    const play = page.getByRole('button', { name: 'Main 24 jam', pressed: true });
    await expect(play).toBeVisible();
    expect(await play.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.locator('#time-label')).toHaveAttribute('aria-live', 'off'); // not read out every frame
    const steps = Number(await page.locator('#time-slider').inputValue());
    expect(steps).toBeGreaterThanOrEqual(4); // 72 min = 4.8 quarter-hour steps
    expect(steps).toBeLessThanOrEqual(6);

    await page.click('#time-play');
    await expect(page.locator('#time-play')).toHaveText('▶');
    await expect(page.getByRole('button', { name: 'Main 24 jam', pressed: false })).toBeVisible();
    await expect(page.locator('#time-label')).toHaveAttribute('aria-live', 'polite');
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
    // No hour suits all three: the closest is offered, with who it misses.
    [['Asia/Kuala_Lumpur', 'America/New_York', 'Asia/Tokyo'], 'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini.'
      + 'Paling sesuai: 09:00–10:00 waktu anda, 2 daripada 3 bandar dalam waktu kerja; New York 21:00 (luar waktu kerja).Pilih 09:00'],
    // The closest can run for several hours.
    [['Asia/Kuala_Lumpur', 'Asia/Dubai', 'America/New_York'], 'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini.'
      + 'Paling sesuai: 13:00–17:00 waktu anda, 2 daripada 3 bandar dalam waktu kerja; New York 01:00 (waktu tidur).Pilih 13:00'],
  ];
  for (const [zones, summary] of cases) {
    test(`ringkasan untuk ${zones.join(' + ')}`, async ({ page }) => {
      await openApp(page, { zones, hour24: true });
      await expect(page.locator('#planner-summary')).toHaveText(summary);
    });
  }

  test('klik satu jam memilihnya tanpa mengubah jam; "Lihat masa ini" melompat; klik lagi membatalkan', async ({ page }) => {
    await openApp(page);
    const hour = page.getByRole('button', { name: 'Pilih 15:00 waktu anda' });
    await hour.click();
    await page.clock.runFor(1100);
    await expect(hour).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText(/^06:00:0\d$/); // the clocks stay on now
    await expect(page.locator('#time-slider')).toHaveValue('0');

    await page.locator('#planner-pick').getByRole('button', { name: 'Lihat masa ini' }).click();
    await page.clock.runFor(1100);
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toHaveText('15:00:00');
    await expect(page.locator('#time-slider')).toHaveValue('36');

    // A cell picks too, and the chosen hour again lets it go.
    await page.locator('#planner-table tbody tr').first().locator('td').nth(15).click();
    await expect(hour).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#planner-pick')).toBeHidden();
  });

  test('pilih jam paling sesuai bila tiada jam untuk semua', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'America/New_York', 'Asia/Tokyo'], hour24: true });
    await page.locator('#planner-summary').getByRole('button', { name: 'Pilih 09:00' }).click();
    await expect(page.locator('#planner-pick .planner-pick-when')).toHaveText('Dipilih: Rabu, 14 Oktober 2026, 09:00–10:00 waktu anda');
    await expect(page.getByRole('button', { name: 'Pilih 09:00 waktu anda' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('tiada cadangan bila tiada sesiapa dalam waktu kerja', async ({ page }) => {
    // Saturday 17 October: a weekend in both cities all day.
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true }, '', new Date('2026-10-17T02:00:00Z'));
    await expect(page.locator('#planner-summary')).toHaveText('Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini (ada bandar sedang hujung minggu).');
    await expect(page.locator('#planner-summary button')).toHaveCount(0);
  });

  test.describe('di telefon', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('jadual diskrol ke jam yang berguna, dengan bayang bila ada lagi di kanan', async ({ page }) => {
      await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'], hour24: true }, '#perancang');
      const scroller = page.locator('.planner-scroll');
      const visible = (hour) => page.evaluate((h) => {
        const box = document.querySelector('.planner-scroll').getBoundingClientRect();
        const head = document.querySelector('#planner-table thead th').getBoundingClientRect();
        const cell = document.querySelectorAll('#planner-table thead th')[h + 1].getBoundingClientRect();
        return cell.left >= head.right - 1 && cell.right <= box.right + 1;
      }, hour);
      // 06:00 now: that column, and the hour before it, are in view.
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      expect(await visible(5)).toBe(true);
      expect(await visible(6)).toBe(true);
      await expect(page.locator('.planner-scroll-wrap')).toHaveClass(/more-right/);
      await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await expect(page.locator('.planner-scroll-wrap')).not.toHaveClass(/more-right/);

      // Another day starts at the beginning of work (09:00).
      await page.getByRole('button', { name: 'Hari berikutnya' }).click();
      expect(await visible(9)).toBe(true);
      // The hourly redraw leaves the reader's scroll alone.
      await scroller.evaluate((el) => { el.scrollLeft = 0; });
      await page.clock.fastForward('01:00:00');
      await page.clock.runFor(1100);
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0);

      // Back on a day with a chosen hour, that hour is what comes into view.
      await page.getByRole('button', { name: 'Hari ini' }).click();
      await page.getByRole('button', { name: 'Pilih 20:00 waktu anda' }).click();
      await page.getByRole('button', { name: 'Hari berikutnya' }).click();
      await page.getByRole('button', { name: 'Hari sebelumnya' }).click();
      expect(await visible(19)).toBe(true);
      expect(await visible(20)).toBe(true);
    });
  });

  test('tarikh boleh dipilih: hari berikutnya, kotak tarikh dan kembali ke hari ini', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo', 'Europe/London'], hour24: true });
    const date = page.getByLabel('Tarikh', { exact: true });
    await expect(date).toHaveValue('2026-10-14');
    await expect(page.locator('#planner-table td.current')).toHaveCount(3);
    await expect(page.locator('#planner-table tbody th small').nth(2)).toHaveText('UTC+1');

    // Saturday 17 October: a weekend in every city, and no "now" column.
    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Hari berikutnya' }).click();
    await expect(date).toHaveValue('2026-10-17');
    await expect(page.locator('#planner-summary')).toHaveText(
      'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada Sabtu, 17 Oktober 2026 (ada bandar sedang hujung minggu).',
    ); // nobody works on Saturday, so nothing is suggested
    await expect(page.locator('#planner-table td.current')).toHaveCount(0);
    await expect(page.locator('#planner-table tbody tr').first().locator('td').nth(10)).toHaveClass(/weekend/);

    // Monday 26 October: London is back on GMT, so its day no longer meets Kuala Lumpur's.
    await date.fill('2026-10-26');
    await expect(page.locator('#planner-table tbody th small').nth(2)).toHaveText('UTC+0');
    await expect(page.locator('#planner-summary')).toHaveText('Tiada jam yang berada dalam waktu kerja untuk semua bandar pada Isnin, 26 Oktober 2026 (ada bandar sedang hujung minggu).'
      + 'Paling sesuai: 15:00–16:00 waktu anda, 2 daripada 3 bandar dalam waktu kerja; London 07:00 (luar waktu kerja).Pilih 15:00');
    // "Pilih" is redrawn away: focus lands on that hour in the table.
    await page.getByRole('button', { name: 'Pilih 15:00', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pilih 15:00 waktu anda' })).toBeFocused();
    await page.getByRole('button', { name: 'Hari sebelumnya' }).click();
    await expect(date).toHaveValue('2026-10-25');

    await page.getByRole('button', { name: 'Hari ini' }).click();
    await expect(date).toHaveValue('2026-10-14');
    await expect(page.locator('#planner-table td.current')).toHaveCount(3);
    // Yesterday has no "now" column either.
    await page.getByRole('button', { name: 'Hari sebelumnya' }).click();
    await expect(date).toHaveValue('2026-10-13');
    await expect(page.locator('#planner-table td.current')).toHaveCount(0);

    // With the clocks a day ahead the planner follows them, but "Hari ini" is the real today.
    await page.getByRole('button', { name: 'Hari ini' }).click();
    await page.locator('#time-slider').fill('96');
    await expect(date).toHaveValue('2026-10-15');
    await page.getByRole('button', { name: 'Hari ini' }).click();
    await expect(date).toHaveValue('2026-10-14');
  });

  test('nama dan waktu kerja sendiri pada kad: disimpan, dan perancang mengikutnya', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Europe/London'], hour24: true });
    const london = card(page, 'Europe/London');
    await expect(london.locator('.person')).toBeHidden();
    await london.getByRole('button', { name: 'Nama dan waktu kerja untuk London' }).click();
    const dialog = page.getByRole('dialog', { name: 'Orang di London' });
    await dialog.getByLabel('Nama').fill('Aina');
    await expect(dialog.getByLabel('Mula')).toBeDisabled(); // the shared day until "own" is ticked
    await dialog.getByLabel('Waktu kerja sendiri').check();
    await dialog.getByLabel('Mula').selectOption('600'); // 10:00
    await dialog.getByLabel('Tamat').selectOption('1140'); // 19:00
    await dialog.getByRole('button', { name: 'Simpan' }).click();
    await expect(dialog).toBeHidden();
    await expect(london.locator('.person')).toHaveText('Aina · kerja 10:00–19:00');
    expect((await storedState(page)).cities[1]).toMatchObject({ name: 'London', label: 'Aina', work: { start: 600, end: 1140, weekend: [6, 0] } });

    const row = page.locator('#planner-table tbody tr').nth(1);
    await expect(row.locator('th')).toContainText('Aina (London)');
    await expect(row.locator('th small').last()).toHaveText('Kerja 10:00–19:00');
    // 16:00 in Kuala Lumpur is 09:00 in London: before Aina's day; 17:00 (10:00) starts it.
    await expect(row.locator('td').nth(16)).toHaveClass(/\boff\b/);
    await expect(row.locator('td').nth(17)).toHaveClass(/\bwork\b/);

    const again = await page.context().newPage();
    await openApp(again); // the saved list
    await expect(card(again, 'Europe/London').locator('.person')).toHaveText('Aina · kerja 10:00–19:00');
    await again.close();

    await london.getByRole('button', { name: 'Nama dan waktu kerja untuk London' }).click();
    await expect(dialog.getByLabel('Nama')).toHaveValue('Aina');
    await dialog.getByRole('button', { name: 'Padam' }).click();
    await expect(london.locator('.person')).toBeHidden();
    expect((await storedState(page)).cities[1]).toEqual({ name: 'London', zone: 'Europe/London', lat: 51.51, lon: -0.13 });
  });

  test('waktu solat dalam perancang: jam yang ditanda, dan jam terbaik mengelaknya bila boleh', async ({ page }) => {
    // JAKIM for Kuala Lumpur (Zohor set at 09:10 here, to meet a working hour); Tokyo is worked out.
    await page.route('https://api.waktusolat.app/v2/solat/gps/**', (route) => {
      const at = (day, hh, mm) => Date.UTC(2026, 9, day, hh - 8, mm) / 1000;
      return route.fulfill({
        json: { zone: 'WLY01', prayers: Array.from({ length: 31 }, (_, i) => ({ day: i + 1, fajr: at(i + 1, 5, 55), dhuhr: at(i + 1, 9, 10), asr: at(i + 1, 16, 20), maghrib: at(i + 1, 19, 12), isha: at(i + 1, 20, 22) })) },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    });
    const modules = [];
    page.on('request', (req) => { if (req.url().endsWith('/js/planner-prayer.js')) modules.push(req.url()); });
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'America/New_York'], hour24: true });
    expect(modules).toEqual([]); // not before the planner nears the screen
    await page.locator('#planner').scrollIntoViewIfNeeded();
    const rows = page.locator('#planner-table tbody tr');
    await expect(rows.nth(0).locator('td.prayer')).toHaveCount(3);
    await expect(rows.nth(0).locator('td').nth(9)).toHaveAttribute('title', 'Zohor 09:10');
    await expect(rows.nth(0).locator('td').nth(19)).toHaveAttribute('title', 'Maghrib 19:12');
    await expect(rows.nth(0).locator('td').nth(9)).toContainText(', Zohor 09:10'); // for screen readers
    // 09:00 and 21:00 each have one city at work and nobody asleep: 09:00 has Zohor, so 21:00.
    await expect(page.locator('#planner-summary .planner-best')).toHaveText(
      'Paling sesuai: 21:00–22:00 waktu anda, 1 daripada 2 bandar dalam waktu kerja; Kuala Lumpur 21:00 (luar waktu kerja).',
    );
    await expect(page.locator('.legend')).toContainText('Waktu solat (Zohor, Asar, Maghrib)');

    // Tokyo by the browser's own reckoning (its position from the city list).
    await addCity(page, 'Tokyo');
    await expect(rows.nth(2).locator('td.prayer')).toHaveCount(3);
    await expect(rows.nth(2).locator('td').nth(13)).toHaveAttribute('title', 'Asar 14:39');
  });

  test('pilih jam dengan papan kekunci: fokus kekal pada jam itu selepas jadual dilukis semula', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true });
    const hour = page.getByRole('button', { name: 'Pilih 10:00 waktu anda' });
    await hour.focus();
    await page.keyboard.press('Enter');
    await expect(hour).toHaveAttribute('aria-pressed', 'true');
    await expect(hour).toBeFocused();
    await page.keyboard.press('Enter'); // again lets it go
    await expect(hour).toHaveAttribute('aria-pressed', 'false');
    await expect(hour).toBeFocused();
  });

  test('lihat masa pada hari yang jauh: penukar menyatakan ia di luar julatnya', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true });
    const slider = page.locator('#time-slider');
    await page.click('#planner-table thead button[aria-label="Pilih 15:00 waktu anda"]');
    await page.getByRole('button', { name: 'Lihat masa ini' }).click();
    await expect(page.locator('#time-label')).toHaveText('+9j dari sekarang · Rab, 14 Okt, 15:00 waktu anda'); // within reach
    await expect(slider).not.toHaveClass(/beyond/);

    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Hari berikutnya' }).click();
    await page.click('#planner-table thead button[aria-label="Pilih 15:00 waktu anda"]');
    await page.getByRole('button', { name: 'Lihat masa ini' }).click();
    await expect(page.locator('#time-label')).toContainText('(di luar julat penukar ±24 jam)');
    await expect(slider).toHaveClass(/beyond/);
    await expect(slider).toHaveValue('96'); // resting at its end

    await page.getByRole('button', { name: 'Kembali ke sekarang' }).click();
    await expect(page.locator('#time-label')).toHaveText('Sekarang');
    await expect(slider).not.toHaveClass(/beyond/);
  });

  test('jam "semua dalam waktu kerja": kontras sekurang-kurangnya 4.5:1 dalam mod cerah dan gelap', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Singapore'], hour24: true });
    const buttons = page.locator('#planner-table thead th.all-work button');
    await expect(buttons).toHaveCount(8); // 09:00–17:00
    // axe leaves these out (a pseudo-element hides their background), so the
    // WCAG ratio is worked out here from the colours as drawn.
    const ratio = () => buttons.first().evaluate((b) => {
      const luminance = (rgb) => {
        const [r, g, bl] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
          const c = Number(v) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      };
      const style = getComputedStyle(b);
      const [hi, lo] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      // Polled: the button's background eases to the new scheme's colour.
      await expect.poll(ratio, { message: scheme }).toBeGreaterThanOrEqual(4.5); // small bold text
    }
  });

  test('jam yang dipilih boleh disimpan ke kalendar (.ics dan Google Calendar)', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo', 'Europe/London'], hour24: true });
    await expect(page.locator('#planner-pick')).toBeHidden();
    await page.getByRole('button', { name: 'Hari berikutnya' }).click();
    await page.click('#planner-table thead button[aria-label="Pilih 15:00 waktu anda"]');
    await page.clock.runFor(1100);

    const pick = page.locator('#planner-pick');
    await expect(pick.locator('.planner-pick-when')).toHaveText('Dipilih: Khamis, 15 Oktober 2026, 15:00–16:00 waktu anda');
    await expect(page.locator('#planner-table thead button[aria-pressed="true"]')).toHaveAttribute('aria-label', 'Pilih 15:00 waktu anda');
    await expect(page.locator('#planner-table td.picked')).toHaveCount(3);

    const google = new URL(await pick.getByRole('link', { name: 'Buka di Google Calendar' }).getAttribute('href'));
    expect(google.origin + google.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(google.searchParams.get('action')).toBe('TEMPLATE');
    expect(google.searchParams.get('text')).toBe('Mesyuarat');
    expect(google.searchParams.get('dates')).toBe('20261015T070000Z/20261015T080000Z');
    expect(google.searchParams.get('details')).toBe(
      'Kuala Lumpur: 15:00–16:00 (Khamis)\nTokyo: 16:00–17:00 (Khamis)\nLondon: 08:00–09:00 (Khamis)\n\nDirancang dengan Jam Dunia',
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pick.getByRole('button', { name: /Muat turun fail kalendar/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('mesyuarat-2026-10-15-1500.ics');
    const ics = require('node:fs').readFileSync(await download.path(), 'utf8');
    const lines = ics.split('\r\n');
    expect(lines.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('\r\nDTSTART:20261015T070000Z\r\n');
    expect(unfolded).toContain('\r\nDTEND:20261015T080000Z\r\n');
    expect(unfolded).toContain('\r\nSUMMARY:Mesyuarat\r\n');
    expect(unfolded).toContain(
      '\r\nDESCRIPTION:Kuala Lumpur: 15:00–16:00 (Khamis)\\nTokyo: 16:00–17:00 (Khamis)\\nLondon: 08:00–09:00 (Khamis)\\n\\nDirancang dengan Jam Dunia\r\n',
    );
    expect(unfolded).toContain('\r\nUID:20261015T070000Z-20261013T220009Z@jam-dunia\r\n');
  });

  test('tempoh dan tajuk mesyuarat: jadual, .ics dan Google mengikut', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true });
    await page.click('#planner-table thead button[aria-label="Pilih 15:00 waktu anda"]');
    const pick = page.locator('#planner-pick');
    const field = await pick.getByLabel('Tajuk').elementHandle();
    await pick.getByLabel('Tajuk').fill('Semakan bajet; Q4');
    await pick.getByLabel('Tempoh').selectOption('90');
    await expect(pick.locator('.planner-pick-when')).toHaveText('Dipilih: Rabu, 14 Oktober 2026, 15:00–16:30 waktu anda');
    expect(await field.evaluate((el) => el.isConnected)).toBe(true); // the bar is not rebuilt under the fields
    // An hour and a half covers two hours of the table.
    await expect(page.locator('#planner-table tbody tr').first().locator('td.picked')).toHaveCount(2);

    const google = new URL(await pick.getByRole('link', { name: 'Buka di Google Calendar' }).getAttribute('href'));
    expect(google.searchParams.get('text')).toBe('Semakan bajet; Q4');
    expect(google.searchParams.get('dates')).toBe('20261014T070000Z/20261014T083000Z');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pick.getByRole('button', { name: /Muat turun fail kalendar/ }).click(),
    ]);
    const ics = require('node:fs').readFileSync(await download.path(), 'utf8').replace(/\r\n /g, '');
    expect(ics).toContain('\r\nSUMMARY:Semakan bajet\\; Q4\r\n');
    expect(ics).toContain('\r\nDTEND:20261014T083000Z\r\n');
  });

  test('pautan mesyuarat: disalin dari bar, dan membuka perancang pada mesyuarat itu', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.clipboard.writeText = async (text) => { window.copiedText = text; };
    });
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true });
    await page.getByRole('button', { name: 'Hari berikutnya' }).click();
    await page.click('#planner-table thead button[aria-label="Pilih 10:00 waktu anda"]');
    const pick = page.locator('#planner-pick');
    await pick.getByLabel('Tajuk').fill('Sync pasukan');
    await pick.getByLabel('Tempoh').selectOption('30');
    await pick.getByRole('button', { name: 'Salin pautan mesyuarat' }).click();
    await expect(pick.getByRole('status')).toHaveText('Pautan disalin ke clipboard.');
    const url = await page.evaluate(() => window.copiedText);
    expect(url).toMatch(/\?bandar=Asia\/Kuala_Lumpur,Asia\/Tokyo&mesyuarat=2026-10-15T02:00:00Z&tempoh=30&tajuk=Sync%20pasukan$/);

    const other = await page.context().newPage();
    await openApp(other, undefined, url.slice(url.indexOf('?')));
    await expect(other.locator('#planner-pick .planner-pick-when')).toHaveText('Dipilih: Khamis, 15 Oktober 2026, 10:00–10:30 waktu anda');
    await expect(other.locator('#planner-pick').getByLabel('Tajuk')).toHaveValue('Sync pasukan');
    await expect(other.locator('#planner-pick').getByLabel('Tempoh')).toHaveValue('30');
    await expect(other.getByLabel('Tarikh', { exact: true })).toHaveValue('2026-10-15');
    await expect(other.locator('#planner-title')).toBeInViewport(); // opened on the planner
    await expect(other.locator('#share-banner')).toBeVisible();
  });

  test('pautan mesyuarat yang rosak: tempoh tidak sah jadi sejam', async ({ page }) => {
    await openApp(page, undefined, '?bandar=Asia/Kuala_Lumpur&mesyuarat=2026-10-14T07:00:00Z&tempoh=7');
    await expect(page.locator('#planner-pick').getByLabel('Tempoh')).toHaveValue('60');
    await expect(page.locator('#planner-pick').getByLabel('Tajuk')).toHaveValue('Mesyuarat');
  });

  test('mesyuarat dari zon setengah jam: setiap jam yang dilaluinya ditanda', async ({ page }) => {
    // 10:00 in India is 12:30 in Kuala Lumpur: an hour from there covers 12 and 13.
    await openApp(page, undefined, '?bandar=Asia/Kuala_Lumpur,Asia/Kolkata&mesyuarat=2026-10-14T04:30:00Z&tempoh=60');
    await expect(page.locator('#planner-table thead th.picked button')).toHaveText(['12', '13']);
    await expect(page.locator('#planner-pick .planner-pick-when')).toHaveText('Dipilih: Rabu, 14 Oktober 2026, 12:30–13:30 waktu anda');
  });

  test('cuti umum Malaysia ikut negeri bandar, dimuat bila perancang hampir kelihatan', async ({ page }) => {
    const holidayRequests = [];
    page.on('request', (req) => { if (req.url().endsWith('/js/my-holidays.js')) holidayRequests.push(req.url()); });
    // Rows of our own: the generated table moves on with the years (.github/workflows/holidays.yml).
    await page.route('**/js/my-holidays.js', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `export const MY_HOLIDAYS = ${JSON.stringify([
        ['2026-06-02', 'Cuti Hari Wesak', ['Selangor', 'W.P. Kuala Lumpur']],
        ['2026-06-02', 'Perayaan Hari Gawai Dayak', ['Sarawak']],
      ])};`,
    }));
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Tokyo'], hour24: true });
    expect(holidayRequests).toEqual([]); // not before the planner is near the screen
    await page.locator('#planner').scrollIntoViewIfNeeded();
    await page.getByLabel('Tarikh', { exact: true }).fill('2026-06-02');
    await expect.poll(() => holidayRequests.length).toBe(1);
    const rows = page.locator('#planner-table tbody tr');
    await expect(rows.nth(0).locator('th .holiday-name')).toHaveText('Cuti: Cuti Hari Wesak');
    await expect(rows.nth(1).locator('th .holiday-name')).toHaveText('Cuti: Perayaan Hari Gawai Dayak'); // Sarawak's own
    await expect(rows.nth(2).locator('th .holiday-name')).toHaveCount(0); // Tokyo
    await expect(rows.nth(0).locator('td').nth(10)).toHaveClass(/holiday/);
    await expect(rows.nth(0).locator('td').nth(23)).toHaveClass(/sleep/); // nights stay nights
    await expect(rows.nth(2).locator('td').nth(10)).toHaveClass(/work/);
    await expect(page.locator('#planner-summary')).toContainText('(ada bandar sedang cuti umum)');
  });

  test('kalendar yang dilanggan: nama dan selang muat semula; fail biasa tanpanya', async ({ page }) => {
    await openApp(page);
    const [subscribed, plain] = await page.evaluate(async () => {
      const { icsCalendar } = await import('./js/calendar.js');
      const event = { uid: 'a@jam-dunia', start: Date.UTC(2026, 9, 15, 7), end: Date.UTC(2026, 9, 15, 8), title: 'Zohor', description: '' };
      return [icsCalendar([event], Date.UTC(2026, 9, 13), { name: 'Waktu solat WLY01 (Kuala Lumpur, Putrajaya)', refreshHours: 12 }), icsCalendar([event], Date.UTC(2026, 9, 13))];
    });
    expect(subscribed).toContain('\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Waktu solat WLY01 (Kuala Lumpur\\, Putrajaya)\r\nREFRESH-INTERVAL;VALUE=DURATION:PT12H\r\nX-PUBLISHED-TTL:PT12H\r\nBEGIN:VEVENT\r\n');
    expect(plain).not.toMatch(/X-WR-CALNAME|REFRESH-INTERVAL|X-PUBLISHED-TTL/);
  });

  test('fail .ics: teks dilepaskan dan baris panjang dilipat ikut bait (RFC 5545)', async ({ page }) => {
    await openApp(page);
    const ics = await page.evaluate(async () => {
      const { icsEvent } = await import('./js/calendar.js');
      return icsEvent({
        start: Date.UTC(2026, 9, 15, 7), end: Date.UTC(2026, 9, 15, 8), now: Date.UTC(2026, 9, 13, 22),
        title: 'Mesyuarat; bajet, pelan \\ lain', description: `${'é'.repeat(80)}\nTamat`,
      });
    });
    const lines = ics.split('\r\n');
    expect(lines.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    // A fold never splits a character: each line is whole UTF-8.
    expect(lines.every((line) => !line.includes('\uFFFD'))).toBe(true);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('\r\nSUMMARY:Mesyuarat\\; bajet\\, pelan \\\\ lain\r\n');
    expect(unfolded).toContain(`\r\nDESCRIPTION:${'é'.repeat(80)}\\nTamat\r\n`);
  });
});

test.describe('waktu kerja dan hujung minggu', () => {
  const row = (page, n) => page.locator('#planner-table tbody tr').nth(n);
  // FIXED_NOW is Wednesday 14 October in Kuala Lumpur and Tokyo.

  test('hujung minggu dan waktu kerja boleh diubah, dan kekal selepas reload', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Asia/Tokyo'], hour24: true });
    // Folded away until asked for; the fold says what is set.
    const settings = page.locator('.planner-settings summary');
    await expect(settings).toHaveText('Waktu kerja 09:00–17:00 · Hujung minggu: Sabtu, Ahad');
    await expect(page.locator('#work-start')).toBeHidden();
    await settings.click();
    await expect(page.locator('#work-start')).toHaveValue('540');
    await expect(page.locator('#work-end')).toHaveValue('1020');
    await expect(page.getByRole('checkbox', { name: 'Sabtu' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Ahad' })).toBeChecked();
    await expect(page.locator('#planner-summary')).toHaveText('Waktu sesuai untuk semua (waktu anda): 09:00–16:00');

    // Wednesday as a weekend day: no working hours today in either city.
    await page.getByRole('checkbox', { name: 'Rabu' }).check();
    await expect(row(page, 0).locator('td').nth(10)).toHaveClass(/weekend/);
    await expect(row(page, 0).locator('td').nth(23)).toHaveClass(/sleep/); // nights stay nights
    await expect(page.locator('#planner-summary')).toHaveText(
      'Tiada jam yang berada dalam waktu kerja untuk semua bandar pada hari ini (ada bandar sedang hujung minggu).',
    );
    await expect(page.locator('#weekend-legend')).toHaveText('Hujung minggu (Rabu, Sabtu, Ahad)');
    await page.getByRole('checkbox', { name: 'Rabu' }).uncheck();

    await page.locator('#work-start').selectOption('600');
    await page.locator('#work-end').selectOption('1080');
    await expect(row(page, 0).locator('td').nth(9)).toHaveClass(/off/);
    await expect(row(page, 0).locator('td').nth(17)).toHaveClass(/work/);
    await expect(page.locator('#work-legend')).toHaveText('Waktu kerja (10:00–18:00)');
    await expect(settings).toHaveText('Waktu kerja 10:00–18:00 · Hujung minggu: Sabtu, Ahad');
    await expect(page.locator('#planner-summary')).toHaveText('Waktu sesuai untuk semua (waktu anda): 10:00–17:00');

    // A fresh page (openApp's stored list would otherwise be written again on reload).
    const again = await page.context().newPage();
    await openApp(again);
    await again.locator('.planner-settings summary').click();
    await expect(again.locator('#work-start')).toHaveValue('600');
    await expect(again.locator('#work-end')).toHaveValue('1080');
    await expect(again.getByRole('checkbox', { name: 'Rabu' })).not.toBeChecked();
    await expect(again.locator('#planner-summary')).toHaveText('Waktu sesuai untuk semua (waktu anda): 10:00–17:00');
  });

  test('hujung minggu ikut hari di bandar itu, bukan hari anda', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'America/New_York'], hour24: true });
    await page.locator('.planner-settings summary').click();
    await page.getByRole('checkbox', { name: 'Selasa' }).check();
    // Midnight Wednesday in Kuala Lumpur is noon Tuesday in New York (and its Zohor, for screen readers).
    await expect(row(page, 1).locator('td').first()).toHaveText(/^12(, |$)/);
    await expect(row(page, 1).locator('td').first()).toHaveClass(/weekend/);
    await expect(row(page, 0).locator('td').nth(10)).toHaveClass(/work/); // Wednesday in Kuala Lumpur
  });

  test('tamat sebelum mula: julat dibetulkan supaya sekurang-kurangnya sejam', async ({ page }) => {
    await openApp(page);
    await page.locator('.planner-settings summary').click();
    await page.locator('#work-start').selectOption('600');
    await page.locator('#work-end').selectOption('600');
    await expect(page.locator('#work-start')).toHaveValue('540');
    await page.locator('#work-start').selectOption('1410');
    await expect(page.locator('#work-end')).toHaveValue('1440');
    await expect(page.locator('#work-legend')).toHaveText('Waktu kerja (23:30–24:00)');
  });

  test('tetapan rosak dalam simpanan diganti dengan lalai', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, work: { start: 900, end: 300, weekend: [6, 0] } });
    await expect(page.locator('#work-legend')).toHaveText('Waktu kerja (09:00–17:00)');
  });
});

test.describe('matahari terbit dan terbenam', () => {
  const cities = [
    { name: 'London', zone: 'Europe/London', lat: 51.507, lon: -0.128 },
    { name: 'Tromsø', zone: 'Europe/Oslo', lat: 69.65, lon: 18.96 },
    { name: 'Kiritimati', zone: 'Pacific/Kiritimati', lat: null, lon: null }, // no position known
  ];
  const byName = (page, name) => page.locator('.card', { has: page.locator('.city', { hasText: name }) });

  test('waktu terbit/terbenam pada kad, dan fasa ikut matahari sebenar', async ({ page }) => {
    // 19:30 in London on the solstice: daylight, though past the fixed 17:00 "day" hours.
    await openApp(page, { cities, hour24: true }, '', new Date('2026-06-21T18:30:00Z'));
    await expect(byName(page, 'London').locator('.sun')).toHaveText('Terbit 04:43 · terbenam 21:21');
    expect(await byName(page, 'London').locator('.sun svg').evaluateAll((icons) => icons.map((i) => i.dataset.glyph))).toEqual(['sunrise', 'sunset']);
    await expect(byName(page, 'London')).toHaveAttribute('data-phase', 'day');
    await expect(byName(page, 'Tromsø').locator('.sun')).toHaveText('Matahari tidak terbenam hari ini');
    await expect(byName(page, 'Tromsø').locator('.sun').locator('svg')).toHaveAttribute('data-glyph', 'sun');
    await expect(byName(page, 'Tromsø')).toHaveAttribute('data-phase', 'day');
    await expect(byName(page, 'Tromsø').locator('.sun-runs span')).toHaveClass(['day']); // the strip: one day-long run
    await expect(byName(page, 'Tromsø').locator('.phase-name')).toHaveText('Siang');
    // Without a position: no times, and the fixed hours decide (08:30 is "day").
    await expect(byName(page, 'Kiritimati').locator('.sun')).toHaveText('');
    await expect(byName(page, 'Kiritimati')).toHaveAttribute('data-phase', 'day');
  });

  test('malam kutub, senja dan format 12 jam', async ({ page }) => {
    // 15:00 in London in December: within the hour before sunset (15:54).
    await openApp(page, { cities, hour24: false }, '', new Date('2026-12-21T15:00:00Z'));
    await expect(byName(page, 'Tromsø').locator('.sun')).toHaveText('Matahari tidak terbit hari ini');
    await expect(byName(page, 'Tromsø').locator('.sun').locator('svg')).toHaveAttribute('data-glyph', 'moon');
    await expect(byName(page, 'Tromsø')).toHaveAttribute('data-phase', 'night');
    await expect(byName(page, 'Tromsø').locator('.sun-runs span')).toHaveClass(['night']); // polar night: one run
    await expect(byName(page, 'London')).toHaveAttribute('data-phase', 'dusk');
    await expect(byName(page, 'London').locator('.sun')).toHaveText(/^Terbit 08:0\d PG · terbenam 03:5\d PTG$/);
  });
});

test.describe('cuaca semasa pada kad', () => {
  const cities = [
    { name: 'Tromsø', zone: 'Europe/Oslo', lat: 69.65, lon: 18.96 },
    { name: 'London', zone: 'Europe/London', lat: 51.507, lon: -0.128 },
    { name: 'Kiritimati', zone: 'Pacific/Kiritimati', lat: null, lon: null }, // no position known
  ];
  const byName = (page, name) => page.locator('.card', { has: page.locator('.city', { hasText: name }) });

  test('satu permintaan untuk semua kad berkedudukan, dikemas kini setiap 15 minit', async ({ page }) => {
    const requests = [];
    await page.route('https://api.open-meteo.com/v1/forecast?**', (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const current = requests.length === 1
        ? [{ temperature_2m: 11.6, weather_code: 3, is_day: 1 }, { temperature_2m: -2.4, weather_code: 0, is_day: 0 }]
        : [{ temperature_2m: 12.2, weather_code: 95, is_day: 1 }, { temperature_2m: -3, weather_code: 73, is_day: 0 }];
      route.fulfill({ json: current.map((c) => ({ current: c })), headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await openApp(page, { cities, hour24: true });
    // Sorted places, so the answer's order is known: London, then Tromsø.
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('latitude')).toBe('51.51,69.65');
    expect(requests[0].searchParams.get('longitude')).toBe('-0.13,18.96');
    expect(requests[0].searchParams.get('current')).toBe('temperature_2m,weather_code,is_day');
    await expect(byName(page, 'London').locator('.weather')).toHaveText('12°C Mendung, ramalan 12 jam');
    await expect(byName(page, 'London').locator('.weather').locator('svg')).toHaveAttribute('data-glyph', 'cloud');
    await expect(byName(page, 'Tromsø').locator('.weather')).toHaveText('−2°C Cerah, ramalan 12 jam');
    await expect(byName(page, 'Tromsø').locator('.weather').locator('svg')).toHaveAttribute('data-glyph', 'moon');
    await expect(byName(page, 'Kiritimati').locator('.weather')).toHaveText('');

    // The time slider shows another time; the weather is only for now.
    await page.locator('#time-slider').fill('8');
    await expect(byName(page, 'London').locator('.weather')).toBeHidden();
    await page.getByRole('button', { name: /Kembali ke sekarang/ }).click();
    await expect(byName(page, 'London').locator('.weather')).toBeVisible();

    // 22:14 is still in the same quarter hour; 22:15 is the next.
    await page.clock.fastForward(14 * 60 * 1000);
    await page.clock.runFor(1100);
    expect(requests).toHaveLength(1);
    await page.clock.fastForward(60 * 1000);
    await page.clock.runFor(1100);
    await expect.poll(() => requests.length).toBe(2);
    await expect(byName(page, 'London').locator('.weather')).toHaveText('12°C Ribut petir, ramalan 12 jam');
    await expect(byName(page, 'London').locator('.weather').locator('svg')).toHaveAttribute('data-glyph', 'storm');
    await expect(byName(page, 'Tromsø').locator('.weather')).toHaveText('−3°C Salji, ramalan 12 jam');
    await expect(byName(page, 'Tromsø').locator('.weather').locator('svg')).toHaveAttribute('data-glyph', 'snow');
  });

  test('ramalan 12 jam dalam kad, dan °F untuk semua suhu, kekal selepas reload', async ({ page }) => {
    const hourlyCalls = [];
    await page.route('https://api.open-meteo.com/v1/forecast?**', (route) => {
      const url = new URL(route.request().url());
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (url.searchParams.has('hourly')) {
        hourlyCalls.push(url);
        const start = Math.floor(Date.UTC(2026, 9, 13, 22) / 1000);
        const time = Array.from({ length: 12 }, (_, i) => start + i * 3600);
        return route.fulfill({ json: { hourly: { time, temperature_2m: time.map((_, i) => (i === 11 ? null : 10 + i)), weather_code: time.map((_, i) => (i < 6 ? 0 : 61)), precipitation_probability: time.map((_, i) => i * 5), is_day: time.map((_, i) => (i < 8 ? 0 : 1)) } }, headers: cors });
      }
      return route.fulfill({ json: [{ current: { temperature_2m: 11.6, weather_code: 3, is_day: 1 } }, { current: { temperature_2m: -2.4, weather_code: 0, is_day: 0 } }], headers: cors });
    });
    await openApp(page, { cities, hour24: true });
    const london = byName(page, 'London');
    const toggle = london.getByRole('button', { name: /12°C Mendung/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(hourlyCalls).toEqual([]); // fetched only when opened
    await toggle.click();
    await expect(london.getByRole('button', { name: /12°C Mendung/ })).toHaveAttribute('aria-expanded', 'true');
    const hours = london.locator('.hourly-list li');
    await expect(hours).toHaveCount(12);
    await expect(hours.first()).toHaveText('23:00Cerah10°C0% peluang hujan'); // London's own clock
    await expect(hours.nth(7).locator('svg')).toHaveAttribute('data-glyph', 'rain');
    await expect(hours.nth(11).locator('strong')).toHaveText('tiada'); // a missing hour, not 0°C
    await expect(london.locator('.hourly-list')).toHaveAttribute('tabindex', '0'); // it scrolls: keyboard users reach it
    expect(hourlyCalls[0].searchParams.get('latitude')).toBe('51.51');
    await expect(london).toHaveAttribute('data-phase', /.+/); // the click did not spin the globe away
    await expect(byName(page, 'Tromsø').locator('.hourly')).toBeHidden();
    await london.getByRole('button', { name: /12°C Mendung/ }).click(); // closes again
    await expect(london.locator('.hourly')).toBeHidden();
    await expect(london.getByRole('button', { name: /12°C Mendung/ })).toHaveAttribute('aria-expanded', 'false');
    await london.getByRole('button', { name: /12°C Mendung/ }).click();
    await expect(hours).toHaveCount(12);

    await page.getByRole('group', { name: 'Unit suhu' }).getByRole('button', { name: '°F' }).click();
    await expect(london.locator('.weather')).toHaveText('53°F Mendung, ramalan 12 jam');
    await expect(hours.first()).toContainText('50°F');
    expect((await storedState(page)).tempUnit).toBe('f');
    const again = await page.context().newPage();
    await openApp(again); // the saved settings, not a fresh list
    await expect(again.getByRole('group', { name: 'Unit suhu' }).getByRole('button', { name: '°F' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('satu bandar: jawapan objek, bukan senarai', async ({ page }) => {
    await page.route('https://api.open-meteo.com/v1/forecast?**', (route) => route.fulfill({
      json: { current: { temperature_2m: 30.4, weather_code: 2, is_day: 1 } }, headers: { 'Access-Control-Allow-Origin': '*' },
    }));
    await openApp(page, { cities: [cities[1]], hour24: true });
    await expect(byName(page, 'London').locator('.weather')).toHaveText('30°C Separa berawan, ramalan 12 jam');
    await expect(byName(page, 'London').locator('.weather').locator('svg')).toHaveAttribute('data-glyph', 'sun-cloud');
  });

  test.describe('bila API cuaca lambat kemudian gagal', () => {
    test.use({ expectedConsole: [/status of 500/] }); // the browser itself reports the failed request

    test('baris cuaca berkata "memuatkan", kemudian berkata ia gagal', async ({ page }) => {
      let answer;
      const held = new Promise((resolve) => { answer = resolve; });
      await page.route('https://api.open-meteo.com/v1/forecast?**', async (route) => {
        await held;
        await route.fulfill({ status: 500, body: '', headers: { 'Access-Control-Allow-Origin': '*' } });
      });
      await openApp(page, { cities, hour24: true });
      await expect(byName(page, 'London').locator('.weather')).toHaveText('Memuatkan cuaca…');
      await expect(byName(page, 'Kiritimati').locator('.weather')).toHaveText(''); // no position, no line
      answer();
      await expect(byName(page, 'London').locator('.weather')).toHaveText('Cuaca tidak dapat dimuat; dicuba lagi setiap 15 minit.');
      await expect(byName(page, 'Kiritimati').locator('.weather')).toHaveText('');
    });
  });
});

test.describe('susun semula kad', () => {
  test('seret pemegang kad ke tempat lain; susunan disimpan dan perancang mengikut', async ({ page }) => {
    await openApp(page);
    await page.locator('#clocks').scrollIntoViewIfNeeded();
    const handle = card(page, 'Asia/Tokyo').locator('.drag-handle');
    const from = await handle.boundingBox();
    const to = await card(page, 'Asia/Kuala_Lumpur').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(card(page, 'Asia/Tokyo')).toHaveClass(/dragging/);
    await page.mouse.up();
    await expect(card(page, 'Asia/Tokyo')).not.toHaveClass(/dragging/);
    expect(await cardZones(page)).toEqual(['Asia/Tokyo', 'Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York']);
    expect(await storedZones(page)).toEqual(['Asia/Tokyo', 'Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York']);
    await expect(page.locator('#planner-table tbody th').first()).toContainText('Tokyo');
  });

  test('memegang kad dekat tepi tetingkap menatal halaman', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await openApp(page);
    await card(page, 'Asia/Tokyo').scrollIntoViewIfNeeded();
    const handle = await card(page, 'Asia/Tokyo').locator('.drag-handle').boundingBox();
    await page.mouse.move(handle.x + 14, handle.y + 14);
    await page.mouse.down();
    const scrollY = () => page.evaluate(() => window.scrollY);
    const before = await scrollY();
    await page.mouse.move(handle.x + 14, 415, { steps: 5 }); // the bottom edge
    await page.clock.runFor(500);
    const lower = await scrollY();
    expect(lower).toBeGreaterThan(before);
    const navBottom = await page.locator('.site-nav').evaluate((n) => n.getBoundingClientRect().bottom);
    await page.mouse.move(handle.x + 14, navBottom + 8, { steps: 5 }); // just under the sticky header
    await page.clock.runFor(500);
    expect(await scrollY()).toBeLessThan(lower);
    await page.mouse.up();
    await expect(page.locator('.card.dragging')).toHaveCount(0);
    const before2 = await scrollY();
    await page.clock.runFor(500);
    expect(await scrollY()).toBe(before2); // scrolling stops with the drag
  });

  test('kekunci anak panah pada pemegang menggerakkan kad', async ({ page }) => {
    await openApp(page);
    const handle = card(page, 'Europe/London').getByRole('button', { name: /^Susun semula London/ });
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    expect(await cardZones(page)).toEqual(['Asia/Kuala_Lumpur', 'America/New_York', 'Europe/London', 'Asia/Tokyo']);
    await expect(page.locator('#reorder-status')).toHaveText('London kini di kedudukan 3 daripada 4.');
    await expect(handle).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp'); // already first: stays
    expect(await storedZones(page)).toEqual(['Europe/London', 'Asia/Kuala_Lumpur', 'America/New_York', 'Asia/Tokyo']);
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
    await showGlobe(page); // the click loads the globe, then turns it
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

  for (const motion of ['reduce', 'no-preference']) {
    test(`klik kad dengan gerakan "${motion}": glob ${motion === 'reduce' ? 'terus berada' : 'masih berpusing'} di Tokyo selepas 50 ms`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await openApp(page);
      await showGlobe(page);
      await page.locator('#globe').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(page.locator('#globe')).toBeInViewport();
      await page.locator('#glob').evaluate(() => document.querySelector('.card[data-zone="Asia/Tokyo"] .city').click()); // no scroll away
      await page.clock.runFor(50); // the turn takes 800 ms when motion is allowed
      const box = await page.locator('#globe').boundingBox();
      const [x, y] = await projectedFromTokyo(page, [126.98, 37.57]); // Seoul, if Tokyo is centred
      await page.mouse.click(box.x + x, box.y + y);
      await page.clock.runFor(50);
      await expect(card(page, 'Asia/Seoul')).toHaveCount(motion === 'reduce' ? 1 : 0);
    });
  }

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
    await showGlobe(page);
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
    await expect(page.locator('#theme-toggle svg')).toHaveAttribute('data-glyph', 'moon');
    // Icons named in the page's markup are drawn in (no emoji left in buttons).
    await expect(page.locator('#share svg')).toHaveAttribute('data-glyph', 'link');
    await expect(page.locator('#map-nearest svg')).toHaveAttribute('data-glyph', 'pin');
    await expect(page.locator('#qibla-open svg')).toHaveAttribute('data-glyph', 'compass');
    expect(await bg()).toBe('#f6faf9');
    await page.click('#theme-toggle');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#theme-toggle svg')).toHaveAttribute('data-glyph', 'sun');
    expect(await bg()).toBe('#0f1b1a');
    // The browser's bar follows the theme chosen by hand, whatever the system says.
    expect(await page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((m) => m.content))).toEqual(['#0f1b1a', '#0f1b1a']);
  });

  test('header telefon 360px kekal dua baris walaupun butang pasang muncul', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await openApp(page);
    await page.evaluate(() => {
      const offer = new Event('beforeinstallprompt', { cancelable: true });
      offer.prompt = () => Promise.resolve();
      window.dispatchEvent(offer);
    });
    await expect(page.getByRole('button', { name: 'Pasang app' })).toBeVisible();
    const rows = await page.evaluate(() => {
      const mid = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.top + r.height / 2; };
      return { brand: mid('.brand'), install: mid('#install'), theme: mid('#theme-toggle'), tabs: mid('.nav-links') };
    });
    expect(Math.abs(rows.brand - rows.theme)).toBeLessThan(8); // one row: brand and buttons
    expect(Math.abs(rows.brand - rows.install)).toBeLessThan(8);
    expect(rows.tabs).toBeGreaterThan(rows.brand + 20); // second row: tabs
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

  test('butang kongsi menyalin pautan yang membuka paparan yang sama', async ({ page }) => {
    // Capture what would be copied; clipboard permissions differ per browser.
    await page.addInitScript(() => {
      navigator.clipboard.writeText = async (text) => { window.copiedText = text; };
    });
    await openApp(page);
    await page.locator('#time-slider').fill('36'); // 06:00 -> 15:00 KL = 07:00 UTC
    await page.click('#share');
    await expect(page.locator('#share-status')).toHaveText('Pautan disalin ke clipboard.');
    const url = await page.evaluate(() => window.copiedText);
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

    // The globe sits below the planner and loads when it nears the screen.
    await showGlobe(page);
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

test.describe('laman web', () => {
  test('jam hero menunjukkan waktu tempatan dan mengikut penukar masa', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#hero-place')).toHaveText('Di Kuala Lumpur, sekarang pukul');
    await expect(page.locator('#hero-time')).toHaveText(/^06:00:\d\d$/);
    await expect(page.locator('#hero-time')).toHaveAttribute('data-phase', 'dawn');

    await page.locator('#time-slider').fill('36');
    await page.clock.runFor(1100);
    await expect(page.locator('#hero-place')).toHaveText('Di Kuala Lumpur, masa yang dipilih ialah');
    await expect(page.locator('#hero-time')).toHaveText('15:00:00');
    await expect(page.locator('#hero-time')).toHaveAttribute('data-phase', 'day');

    await page.uncheck('#format24');
    await expect(page.locator('#hero-time')).toHaveText('03:00:00 PTG');
  });

  test('tab navigasi menukar panel dan pautan dalam panel masih berfungsi', async ({ page }) => {
    await openApp(page);
    const targets = await page.locator('.nav-links a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(targets).toEqual(['#dunia', '#malaysia', '#bandar-malaysia']);
    await expect(page.locator('#dunia')).toBeVisible();
    await expect(page.locator('.nav-links a[href="#dunia"]')).toHaveAttribute('aria-current', 'page');

    await page.click('.nav-links a[href="#malaysia"]');
    await expect(page.locator('#malaysia')).toBeVisible();
    await expect(page.locator('#dunia')).toBeHidden();
    await expect(page.locator('.nav-links a[href="#malaysia"]')).toHaveAttribute('aria-current', 'page');

    // A link to a section inside another tab opens that tab.
    await page.goto(`${APP_URL}#perancang`);
    await page.clock.runFor(500);
    await expect(page.locator('#perancang')).toBeVisible();
    await expect(page.locator('#malaysia')).toBeHidden();
  });

  test('elemen tersembunyi kekal tersembunyi semasa dimuat', async ({ page }) => {
    await openApp(page);
    for (const id of ['#time-reset', '#share-banner', '#share-status']) {
      await expect(page.locator(id)).toBeHidden();
    }
  });
});

test.describe('susun atur', () => {
  test.describe('telefon', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('kad bandar pertama kelihatan pada skrin pertama', async ({ page }) => {
      await openApp(page);
      const top = await card(page, 'Asia/Kuala_Lumpur').evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeLessThan(844 - 60); // at least the city name and its time
      await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toBeInViewport();
      await expect(page.locator('#hero-time')).toBeInViewport();
    });
  });

  // The city list comes straight after your own time (DESIGN.md): no
  // introduction or globe above it, on a 720 px laptop screen too.
  test('desktop: masa bandar pertama pada skrin pertama, glob di bawah perancang', async ({ page }) => {
    await openApp(page);
    await expect(card(page, 'Asia/Kuala_Lumpur').locator('.time')).toBeInViewport();
    await expect(page.locator('#time-control')).toBeInViewport();
    const order = await page.locator('#dunia > section').evaluateAll((s) => s.map((x) => x.id).filter(Boolean));
    expect(order.indexOf('sekarang')).toBe(0);
    expect(order.indexOf('glob')).toBeGreaterThan(order.indexOf('perancang'));
  });

  test('hero: jam dan tarikh pada satu baris', async ({ page }) => {
    await openApp(page);
    const box = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON());
    const time = await box('#hero-time');
    const date = await box('#hero-date');
    expect(date.left).toBeGreaterThan(time.right);
    expect(date.bottom).toBeLessThanOrEqual(time.bottom + 2);
    expect(time.height).toBeLessThan(80); // compact, not the old 6rem
  });

  test('fakta: dua dahulu, selebihnya bila diminta; privasi dilipat', async ({ page }) => {
    await openApp(page);
    const facts = page.locator('#facts-list > li');
    await expect(facts.filter({ visible: true })).toHaveCount(2);
    const more = page.getByRole('button', { name: 'Lihat 4 fakta lagi' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(facts.filter({ visible: true })).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Tunjuk 2 fakta sahaja' })).toHaveAttribute('aria-expanded', 'true');

    const privacy = page.locator('details.privacy');
    await expect(privacy.getByText(/dibundarkan kepada kira-kira 1 km/)).toBeHidden();
    await privacy.locator('summary').click();
    await expect(privacy.getByText(/dibundarkan kepada kira-kira 1 km/)).toBeVisible();
  });

  test('grid kad: baris akhir tidak tinggal sebuah kad', async ({ page }) => {
    const zones = ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Europe/Paris', 'Asia/Dubai'];
    const columns = () => page.locator('#clocks').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    // At 1280px three cards fit across: 3 -> 3, 4 -> 2 + 2, 5 -> 3 + 2, 6 -> 3 + 3.
    for (const [count, expected] of [[3, 3], [4, 2], [5, 3], [6, 3]]) {
      const fresh = await page.context().newPage();
      await openApp(fresh, { zones: zones.slice(0, count), hour24: true });
      expect(await fresh.locator('#clocks').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), `${count} kad`).toBe(expected);
      await fresh.close();
    }
    // Removing a card rebalances at once.
    await openApp(page, { zones: zones.slice(0, 4), hour24: true });
    expect(await columns()).toBe(2);
    await card(page, 'Asia/Tokyo').locator('.remove').click();
    await expect.poll(columns).toBe(3);
  });

  test.describe('telefon: pautan terus', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('tajuk sasaran tidak tersorok di bawah header dua baris', async ({ page }) => {
      for (const [hash, heading] of [['#malaysia', '#my-title'], ['#bandar-malaysia', '#map-title'], ['#perancang', '#planner-title']]) {
        await openApp(page, undefined, hash);
        const header = await page.locator('.site-nav').evaluate((el) => el.getBoundingClientRect().bottom);
        const top = await page.locator(heading).evaluate((el) => el.getBoundingClientRect().top);
        expect(top, hash).toBeGreaterThanOrEqual(header);
      }
    });
  });

  test('tab Malaysia bermula dengan waktu solat zon anda', async ({ page }) => {
    await openApp(page, undefined, '#malaysia');
    const headings = page.locator('#malaysia h2:visible');
    await expect(headings.first()).toHaveText('Waktu solat zon anda');
    await expect(headings.nth(1)).toHaveText('Takwim Islam'); // the Islamic calendar goes with the prayer times
    await expect(headings.nth(2)).toHaveText('Negeri hari ini'); // the tile map, then the warnings in full
    await expect(headings.nth(3)).toHaveText('Amaran');
  });
});

test.describe('pangkalan data bandar', () => {
  const byKey = (page, key) => page.locator(`.card[data-key="${key}"]`);

  test('bandar dalam zon yang sama menjadi kad berasingan', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'Johor Bahru');
    const jb = byKey(page, 'Asia/Kuala_Lumpur~Johor Bahru');
    await expect(jb.locator('.city')).toHaveText('Johor Bahru');
    await expect(jb.locator('.utc')).toHaveText('UTC+8');
    await expect(byKey(page, 'Asia/Kuala_Lumpur~Kuala Lumpur')).toHaveCount(1);

    await addCity(page, 'johor bahru');
    await expect(page.locator('#form-error')).toHaveText('Johor Bahru sudah ada dalam senarai.');
    await expect(page.locator('.card')).toHaveCount(5);
  });

  test('nama Melayu, nama negara dan bandar paling besar dahulu', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'Mekah');
    await expect(byKey(page, 'Asia/Riyadh~Mekah').locator('.utc')).toHaveText('UTC+3');
    await addCity(page, 'kota bharu');
    await expect(byKey(page, 'Asia/Kuala_Lumpur~Kota Bharu')).toHaveCount(1);
    await addCity(page, 'George Town'); // the one in Penang, not the Cayman Islands
    await expect(byKey(page, 'Asia/Kuala_Lumpur~George Town')).toHaveCount(1);
    await addCity(page, 'George Town, Cayman Islands');
    await expect(byKey(page, 'America/Cayman~George Town').locator('.utc')).toHaveText('UTC−5');
  });

  test('senarai bandar hanya dimuat bila carian digunakan', async ({ page }) => {
    await openApp(page);
    expect(await page.evaluate(() => 'WORLD_CITIES' in window)).toBe(false);
    await page.focus('#zone-input');
    // Thousands of cities, but only 50 suggestions at a time, matching what is typed.
    await expect.poll(() => page.locator('#zone-list option').count()).toBe(50);
    await page.fill('#zone-input', 'johor');
    await expect(page.locator('#zone-list option[value="Johor Bahru, Malaysia"]')).toHaveCount(1);
    await page.fill('#zone-input', 'lumpur'); // inside a name too, after names that start with it
    await expect(page.locator('#zone-list option[value="Kuala Lumpur, Malaysia"]')).toHaveCount(1);
  });

  test('bandar yang dicari mendapat titik sendiri pada glob', async ({ page }) => {
    await openApp(page);
    await addCity(page, 'Johor Bahru');
    await byKey(page, 'Asia/Kuala_Lumpur~Johor Bahru').locator('.city').click();
    await showGlobe(page);
    await page.clock.runFor(1000);
    await page.locator('#globe').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('#globe')).toBeInViewport();
    await page.clock.runFor(100);
    const box = await page.locator('#globe').boundingBox();
    if (!box) throw new Error('globe canvas not rendered');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.clock.runFor(200);
    await expect(page.locator('.globe-tip')).toContainText('Johor Bahru');
  });

  test('senarai lama (zon sahaja) dipindahkan ke format bandar', async ({ page }) => {
    await openApp(page, { zones: ['Asia/Kuala_Lumpur', 'Europe/Kyiv'], hour24: true });
    await expect(page.locator('.card .city')).toHaveText(['Kuala Lumpur', 'Kyiv']);
    await page.uncheck('#format24'); // any change saves
    const stored = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
    expect(stored).not.toHaveProperty('zones');
    expect(stored.cities).toEqual([
      { name: 'Kuala Lumpur', zone: 'Asia/Kuala_Lumpur', lat: 3.14, lon: 101.69 },
      { name: 'Kyiv', zone: 'Europe/Kyiv', lat: null, lon: null },
    ]);
  });

  test('pautan kongsi membawa nama bandar dan mencari kedudukannya', async ({ page }) => {
    await openApp(page, undefined, '?bandar=Asia/Kuala_Lumpur,Asia/Kuala_Lumpur~Johor%20Bahru');
    await expect(page.locator('.card .city')).toHaveText(['Kuala Lumpur', 'Johor Bahru']);
    await expect(byKey(page, 'Asia/Kuala_Lumpur~Johor Bahru')).toHaveClass(/on-globe/);

    await page.addInitScript(() => {
      navigator.clipboard.writeText = async (text) => { window.copiedText = text; };
    });
    await page.reload();
    await page.clock.runFor(1100);
    await page.click('#share');
    await expect.poll(() => page.evaluate(() => window.copiedText)).toMatch(/\?bandar=Asia\/Kuala_Lumpur,Asia\/Kuala_Lumpur~Johor%20Bahru$/);
  });
});

test.describe('prestasi', () => {
  test('paparan pertama: bajet saiz, dan peta serta pangkalan bandar tidak dimuat', async ({ page }) => {
    // Every response up to the load event; modules fetched later (the planner's,
    // once it nears the screen) are not counted, and their bodies are not read
    // after the test has ended.
    const bodies = [];
    const onResponse = (res) => {
      const url = new URL(res.url());
      if (url.hostname === 'localhost') bodies.push(res.body().then((body) => ({ path: url.pathname, bytes: body.length })));
    };
    page.on('response', onResponse);
    await openApp(page);
    await page.waitForLoadState('load');
    page.off('response', onResponse);
    const loaded = await Promise.all(bodies);
    const total = loaded.reduce((n, r) => n + r.bytes, 0);
    expect(total, loaded.map((r) => `${r.path} ${r.bytes}`).join('\n')).toBeLessThan(450 * 1024); // uncompressed
    expect(loaded.map((r) => r.path).filter((p) => /maplibre|vendor\/cities\.js|malaysia-states/.test(p))).toEqual([]);
  });

  test('setiap modul dipramuat dan disimpan untuk luar talian', async ({ page }) => {
    // Every module the page loads, as fetched while it starts.
    const modules = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname.slice(1);
      if (/^(js\/[\w-]+\.js|globe\.js|malaysia-data\.js)$/.test(path) && !modules.includes(path)) modules.push(path);
    });
    await openApp(page);
    await page.waitForLoadState('load');
    const preloaded = await page.locator('link[rel="modulepreload"]').evaluateAll((links) => links.map((l) => l.getAttribute('href')));
    const sw = await (await page.request.get('sw.js')).text();
    expect(modules.length).toBeGreaterThan(10);
    for (const m of modules) {
      expect(preloaded, `${m} tiada modulepreload`).toContain(m);
      expect(sw, `${m} tiada dalam precache sw.js`).toContain(`'${m}'`);
    }
  });
});

test.describe('PWA dan pratonton pautan', () => {
  test('manifest dan semua ikon boleh dimuat', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
    const response = await page.request.get('manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: 'Jam Dunia', display: 'standalone', start_url: './' });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    for (const icon of [...manifest.icons.map((i) => i.src), 'icons/apple-touch-icon.png', 'icons/icon.svg']) {
      const res = await page.request.get(icon);
      expect(res.ok(), icon).toBe(true);
    }
  });

  test('pintasan app membuka tab yang betul', async ({ page }) => {
    const manifest = await (await page.request.get('manifest.webmanifest')).json();
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['./#malaysia', './#bandar-malaysia', './#perancang']);
    for (const [url, tab] of [['#malaysia', 'malaysia'], ['#perancang', 'dunia']]) {
      await openApp(page, undefined, url);
      await expect(page.locator(`#${tab}`)).toBeVisible();
    }
  });

  test('butang pasang muncul bila pelayar menawarkan pemasangan', async ({ page }) => {
    await openApp(page);
    const install = page.getByRole('button', { name: 'Pasang app' });
    await expect(install).toBeHidden(); // no offer yet (and never in Safari or Firefox)
    const prevented = await page.evaluate(() => {
      const offer = new Event('beforeinstallprompt', { cancelable: true });
      offer.prompt = () => {
        window.promptShown = (window.promptShown ?? 0) + 1;
        return Promise.resolve();
      };
      window.dispatchEvent(offer);
      return offer.defaultPrevented; // the browser's own banner is held back for our button
    });
    expect(prevented).toBe(true);
    await install.click();
    expect(await page.evaluate(() => window.promptShown)).toBe(1);
    await expect(install).toBeHidden();
  });

  test('tag pratonton pautan menunjuk ke imej yang wujud', async ({ page }) => {
    await openApp(page);
    const meta = (selector) => page.locator(selector).getAttribute('content');
    expect(await meta('meta[property="og:title"]')).toBe('Jam Dunia');
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    const image = await meta('meta[property="og:image"]');
    expect(image).toBe('https://rafiqihaziq321-lgtm.github.io/world-timezone/og-image.png');
    const res = await page.request.get('og-image.png');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toBe('image/png');
  });

  test.describe('dengan service worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('boleh dibuka tanpa internet selepas lawatan pertama', async ({ page, context }) => {
      await openApp(page);
      await page.clock.resume(); // page-side polling below needs real timers
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await context.setOffline(true); // the reload fails unless the service worker serves the cache
      await page.reload();
      await expect(page.locator('#hero-title')).toBeVisible();
      await expect(page.locator('.card')).toHaveCount(4);
      expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Plus Jakarta Sans');
      await context.setOffline(false);
    });
  });
});

test.describe('bandar Malaysia: solat, cuaca dan IPU', () => {
  // A month of JAKIM-style times for October 2026, as Unix seconds (KL is UTC+8).
  const at = (day, hh, mm) => Date.UTC(2026, 9, day, hh - 8, mm) / 1000;
  const prayerMonth = {
    zone: 'WLY01',
    year: 2026,
    month: 'OCT',
    month_number: 10,
    last_updated: null,
    prayers: Array.from({ length: 31 }, (_, i) => ({
      day: i + 1,
      hijri: '1448-04-01',
      imsak: at(i + 1, 5, 45),
      fajr: at(i + 1, 5, 55),
      syuruk: at(i + 1, 7, 5),
      dhuha: at(i + 1, 7, 30),
      dhuhr: at(i + 1, 13, 10),
      asr: at(i + 1, 16, 20),
      maghrib: at(i + 1, 19, 12),
      isha: at(i + 1, 20, 22),
    })),
  };
  const forecast = (date, name, morning) => ({
    location: { location_id: 'Ds001', location_name: name },
    date,
    morning_forecast: morning,
    afternoon_forecast: 'Ribut petir di beberapa tempat',
    night_forecast: 'Tiada hujan',
    summary_forecast: 'Ribut petir di beberapa tempat',
    summary_when: 'Petang',
    min_temp: 24,
    max_temp: 33,
  });

  async function mockApis(page, { weatherStatus = 200 } = {}) {
    const calls = { prayer: [], weather: [] };
    await page.route('https://api.waktusolat.app/**', (route) => {
      calls.prayer.push(route.request().url());
      return route.fulfill({ json: prayerMonth, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.route('https://api.data.gov.my/**', (route) => {
      calls.weather.push(route.request().url());
      if (weatherStatus !== 200) return route.fulfill({ status: weatherStatus, body: 'error' });
      return route.fulfill({
        json: [
          forecast('2026-10-14', 'Kuala Lumpur', 'Tiada hujan'),
          forecast('2026-10-15', 'Kuala Lumpur', 'Hujan di satu dua tempat'),
          forecast('2026-10-14', 'Kuala Lumpur Utara', 'Berjerebu'),
        ],
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    });
    return calls;
  }

  const kl = (page) => page.locator('.card[data-key="Asia/Kuala_Lumpur~Kuala Lumpur"]');

  test('panel JAKIM dan cuaca untuk bandar Malaysia; data hanya diambil bila dibuka', async ({ page }) => {
    const calls = await mockApis(page);
    await openApp(page);
    await expect(kl(page).locator('.local-toggle')).toHaveText('Solat & cuaca');
    await expect(card(page, 'Asia/Tokyo').locator('.local-toggle')).toHaveText('Waktu solat'); // worked out, not fetched
    await page.clock.runFor(2000);
    expect(calls.prayer).toEqual([]);
    expect(calls.weather).toEqual([]);

    await kl(page).locator('.local-toggle').click();
    await expect(kl(page).locator('.local-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(kl(page).locator('.prayer-times li')).toHaveCount(6);
    expect(calls.prayer).toEqual(['https://api.waktusolat.app/v2/solat/gps/3.14/101.69?year=2026&month=10']);
    expect(calls.weather[0]).toContain('contains=Kuala%20Lumpur@location__location_name');
  });

  test('bandar luar Malaysia: waktu solat dikira dalam pelayar, kaedah ikut negara, tanpa rangkaian', async ({ page }) => {
    const calls = await mockApis(page);
    const modules = [];
    page.on('request', (req) => { if (/\/js\/(world-prayer|prayer-calc)\.js$/.test(req.url())) modules.push(new URL(req.url()).pathname); });
    await openApp(page); // 06:00 in Kuala Lumpur, 07:00 in Tokyo
    expect(modules).toEqual([]); // fetched only when a panel opens
    const tokyo = card(page, 'Asia/Tokyo');
    await tokyo.locator('.local-toggle').click();
    const panel = tokyo.locator('.local-panel');
    await expect(panel.locator('.prayer-times li')).toHaveText(['Subuh04:21', 'Syuruk05:46', 'Zohor11:28', 'Asar14:40', 'Maghrib17:08', 'Isyak18:28']);
    await expect(panel.locator('h3').first()).toHaveText('Waktu solat Liga Dunia Islam (MWL)');
    await expect(panel.locator('.prayer-times li.next span')).toHaveText('Zohor');
    await expect(panel.locator('.next-prayer')).toHaveText('Seterusnya: Zohor dalam 4j 28m');
    await expect(panel.locator('.qibla')).toHaveCount(1);
    await expect(panel.locator('.local-source')).toContainText('Dikira dalam pelayar ini');
    expect(calls.prayer.filter((url) => !url.includes('/3.14/101.69'))).toEqual([]); // no service asked for Tokyo (Kuala Lumpur's are the planner's)
    await expect(tokyo).toHaveAttribute('data-phase', /.+/); // the click did not send the globe away
  });

  test('papar waktu solat, solat seterusnya, cuaca dan pautan IPU', async ({ page }) => {
    await mockApis(page);
    await openApp(page);
    await kl(page).locator('.local-toggle').click();
    const panel = kl(page).locator('.local-panel');
    await expect(panel.locator('.prayer-times li')).toHaveText(['Subuh05:55', 'Syuruk07:05', 'Zohor13:10', 'Asar16:20', 'Maghrib19:12', 'Isyak20:22']);
    await expect(panel.locator('h3').first()).toContainText('zon WLY01');
    await expect(panel.locator('.next-prayer')).toHaveText('Seterusnya: Zohor dalam 7j 10m'); // it is 06:00
    await expect(panel.locator('.prayer-times li.next span')).toHaveText('Zohor');
    // Exact location wins over "Kuala Lumpur Utara".
    await expect(panel.locator('.forecast dd')).toHaveText(['Tiada hujan', 'Ribut petir di beberapa tempat', 'Tiada hujan']);
    await expect(panel.locator('.local-block').nth(1).locator('h3')).toContainText('24–33°C');
    await expect(panel.locator('.local-link')).toHaveAttribute('href', 'https://eqms.doe.gov.my/');
  });

  test('panel mengikut penukar masa', async ({ page }) => {
    await mockApis(page);
    await openApp(page);
    await kl(page).locator('.local-toggle').click();
    const panel = kl(page).locator('.local-panel');
    await page.locator('#time-slider').fill('40'); // 06:00 -> 16:00
    await page.clock.runFor(1100);
    await expect(panel.locator('.next-prayer')).toHaveText('Seterusnya: Asar dalam 20m');
    await page.locator('#time-slider').fill('96'); // tomorrow 06:00
    await page.clock.runFor(1100);
    await expect(panel.locator('.forecast dd').first()).toHaveText('Hujan di satu dua tempat');
  });

  test.describe('bila API cuaca gagal', () => {
    // The browser itself reports the failed request.
    test.use({ expectedConsole: [/status of 500/] });

    test('ralat cuaca dipaparkan dan boleh dicuba semula tanpa menjejaskan waktu solat', async ({ page }) => {
      const calls = await mockApis(page, { weatherStatus: 500 });
      await openApp(page);
      await kl(page).locator('.local-toggle').click();
      const panel = kl(page).locator('.local-panel');
      await expect(panel.locator('.prayer-times li')).toHaveCount(6);
      await expect(panel.getByText('Ramalan cuaca tidak dapat dimuat.')).toBeVisible();

      await page.unroute('https://api.data.gov.my/**');
      await mockApis(page);
      await panel.getByRole('button', { name: 'Cuba lagi' }).click();
      await expect(panel.locator('.forecast dd').first()).toHaveText('Tiada hujan');
      expect(calls.weather.length).toBe(1);
    });
  });
});

test.describe('tab Malaysia dan Bandar Malaysia', () => {
  const at = (day, hh, mm) => Date.UTC(2026, 9, day, hh - 8, mm) / 1000;
  const prayerMonth = {
    zone: 'WLY01',
    prayers: Array.from({ length: 31 }, (_, i) => ({
      day: i + 1, fajr: at(i + 1, 5, 55), syuruk: at(i + 1, 7, 5), dhuhr: at(i + 1, 13, 10),
      asr: at(i + 1, 16, 20), maghrib: at(i + 1, 19, 12), isha: at(i + 1, 20, 22),
    })),
  };
  const forecast = (id, name, date, summary) => ({
    location: { location_id: id, location_name: name }, date,
    morning_forecast: 'Tiada hujan', afternoon_forecast: summary, night_forecast: 'Tiada hujan',
    summary_forecast: summary, summary_when: 'Petang', min_temp: 24, max_temp: 33,
  });
  // MET spells some states its own way; the app must still match them.
  const stateRows = [
    forecast('St001', 'Selangor', '2026-10-14', 'Ribut petir di beberapa tempat'),
    forecast('St002', 'WP Kuala Lumpur', '2026-10-14', 'Tiada hujan'),
    forecast('St003', 'Penang', '2026-10-14', 'Berjerebu'),
    forecast('St001', 'Selangor', '2026-10-15', 'Hujan di satu dua tempat'),
  ];
  const warnings = [
    { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Hujan Lebat (Waspada)' }, valid_from: '2026-10-14T05:00:00', valid_to: '2026-10-15T00:00:00', text_bm: 'Hujan lebat dijangka di Selangor.' },
    { warning_issue: { issued: '2026-10-12T05:00:00', title_bm: 'Amaran Lama' }, valid_from: '2026-10-12T05:00:00', valid_to: '2026-10-13T12:00:00', text_bm: 'Sudah tamat.' },
  ];
  const quakes = [
    { localdatetime: '2026-10-14T03:10:00', magdefault: 5.1, location: 'Laut Sulawesi', nbm_distancemas: '420km TG Tawau, Sabah', visible: true },
    { localdatetime: '2026-10-13T03:10:00', magdefault: 3.0, location: 'Tersembunyi', visible: false },
  ];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

  // A 256×256 terrarium elevation tile of sea level, rgb(128, 0, 0).
  const DEM_TILE = (() => {
    const chunk = (type, data) => {
      const typed = Buffer.concat([Buffer.from(type), data]);
      const out = Buffer.alloc(data.length + 12);
      out.writeUInt32BE(data.length, 0);
      typed.copy(out, 4);
      out.writeUInt32BE(crc32(typed) >>> 0, typed.length + 4);
      return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(256, 0);
    header.writeUInt32BE(256, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // RGB
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(256 * 3, Buffer.from([128, 0, 0]))]);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(Array(256).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
  })();
  const MAP_STYLE = { version: 8, sources: {}, layers: [{ id: 'laut', type: 'background', paint: { 'background-color': '#a9d2ee' } }] };

  // Hourly PM for each capital, in MALAYSIA_STATES order. Hours outside the
  // last 24 read 999, so averaging the wrong hours shows up in the index.
  const NOW_S = Math.floor(FIXED_NOW.getTime() / 1000);
  const airSeries = (pm25, pm10, validHours = 24) => {
    const time = Array.from({ length: 72 }, (_, i) => Math.floor(NOW_S / 3600) * 3600 + (i - 47) * 3600);
    const inWindow = (t) => t > NOW_S - 24 * 3600 && t <= NOW_S;
    const valid = (t) => inWindow(t) && t > NOW_S - validHours * 3600;
    return {
      hourly: {
        time,
        pm2_5: time.map((t) => (valid(t) ? pm25 : inWindow(t) ? null : 999)),
        pm10: time.map((t) => (valid(t) ? pm10 : inWindow(t) ? null : 999)),
      },
    };
  };
  const STATE_ORDER = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis',
    'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya'];
  // MALAYSIA_TOWNS order, after the capitals in the air-quality request.
  const TOWN_ORDER = ['Batu Pahat', 'Kluang', 'Muar', 'Sungai Petani', 'Raub', 'Kuala Lipis', 'Taiping', 'Teluk Intan',
    'Butterworth', 'Sandakan', 'Tawau', 'Lahad Datu', 'Miri', 'Sibu', 'Bintulu', 'Klang', 'Chukai'];
  const airRows = [
    ...STATE_ORDER.map((state) => ({
      'W.P. Kuala Lumpur': airSeries(42, 30), // PM2.5 120% of its standard
      Sarawak: airSeries(10, 160), // PM10 160% of its standard
      Kedah: airSeries(20, 30), // 57, Sederhana: a green badge for the contrast check
      'W.P. Labuan': airSeries(5, 5, 10), // too few hours for an estimate
    }[state] ?? airSeries(7, 10))),
    ...TOWN_ORDER.map((town) => (town === 'Sandakan' ? airSeries(20, 30) : airSeries(7, 10))),
  ];
  // Today's forecast for every MET location; Kluang appears under MET's spelling.
  const allLocationsToday = [
    forecast('Tn010', 'Sandakan', '2026-10-14', 'Ribut petir di satu dua tempat'),
    forecast('Tn011', 'Keluang', '2026-10-14', 'Berjerebu'),
    forecast('Tn012', 'Kuala Lumpur', '2026-10-14', 'Tiada hujan'),
  ];

  const longWarning = 'Ribut petir, hujan lebat dan angin kencang dijangka berlaku sehingga jam 6:00 petang di kawasan berikut: '
    + 'Perak (Hulu Perak, Kuala Kangsar, Kinta); Pahang (Cameron Highlands, Lipis, Raub); Selangor (Gombak, Petaling).';

  // The same month during Ramadan by JAKIM's calendar: 14 October is 5 Ramadan.
  const ramadanMonth = {
    ...prayerMonth,
    prayers: prayerMonth.prayers.map((p) => ({
      ...p,
      imsak: p.fajr - 600,
      hijri: p.day >= 10 ? `1448-09-${String(p.day - 9).padStart(2, '0')}` : `1448-08-${String(p.day + 20).padStart(2, '0')}`,
    })),
  };

  async function mockAll(page, { wikiStatus = 200, warningStatus = 200, warningRows = warnings, styleStatus = 200, airStatus = 200, prayers = prayerMonth } = {}) {
    const calls = { dataGov: [], wiki: 0, air: [] };
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await page.route('https://tiles.openfreemap.org/**', (route) => (styleStatus === 200
      ? route.fulfill({ json: MAP_STYLE, headers: cors })
      : route.fulfill({ status: styleStatus, body: 'error', headers: cors })));
    await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.fulfill({ body: DEM_TILE, contentType: 'image/png', headers: cors }));
    await page.route('https://air-quality-api.open-meteo.com/**', (route) => {
      calls.air.push(route.request().url());
      if (airStatus !== 200) return route.fulfill({ status: airStatus, body: 'error', headers: cors });
      return route.fulfill({ json: airRows, headers: cors });
    });
    await page.route('https://api.waktusolat.app/**', (route) => route.fulfill({ json: prayers, headers: cors }));
    await page.route('https://api.data.gov.my/**', (route) => {
      const url = route.request().url();
      calls.dataGov.push(url);
      if (url.includes('/warning/earthquake')) return route.fulfill({ json: quakes, headers: cors });
      if (url.includes('/warning')) {
        if (warningStatus !== 200) return route.fulfill({ status: warningStatus, body: 'limit', headers: cors });
        return route.fulfill({ json: warningRows, headers: cors });
      }
      if (url.includes('contains=St@')) return route.fulfill({ json: stateRows, headers: cors });
      if (url.includes('include=location')) return route.fulfill({ json: allLocationsToday, headers: cors });
      return route.fulfill({
        headers: cors,
        json: [
          forecast('Tn001', 'Kuala Lumpur', '2026-10-14', 'Hujan di satu dua tempat'),
          forecast('Tn001', 'Kuala Lumpur', '2026-10-15', 'Ribut petir di beberapa tempat'),
          forecast('Tn001', 'Kuala Lumpur', '2026-10-16', 'Tiada hujan'),
        ],
      });
    });
    await page.route('https://en.wikipedia.org/w/api.php**', (route) => {
      calls.wiki += 1;
      if (wikiStatus !== 200) return route.fulfill({ status: wikiStatus, body: 'error', headers: cors });
      const url = new URL(route.request().url());
      const titles = url.searchParams.get('titles').split('|');
      if (url.searchParams.get('prop') === 'pageimages') {
        const spaced = titles.map((t) => t.replace(/_/g, ' '));
        // "Alwi Mosque" redirects, exercising the redirect mapping.
        const final = spaced.map((t) => (t === 'Alwi Mosque' ? 'Masjid Alwi' : t));
        return route.fulfill({
          headers: cors,
          json: {
            query: {
              normalized: titles.map((t, i) => ({ from: t, to: spaced[i] })),
              redirects: [{ from: 'Alwi Mosque', to: 'Masjid Alwi' }],
              pages: final.map((title, i) => ({
                title, pageimage: `Photo_${i}.jpg`,
                thumbnail: { source: `https://upload.wikimedia.org/test/${i}.png`, width: 800, height: 600 },
              })),
            },
          },
        });
      }
      return route.fulfill({
        headers: cors,
        json: {
          query: {
            pages: titles.map((t) => ({
              title: t.replace(/_/g, ' '),
              imageinfo: [{ extmetadata: { Artist: { value: '<a href="https://example.org">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
            })),
          },
        },
      });
    });
    await page.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png', headers: cors }));
    return calls;
  }

  test('tab Malaysia: amaran aktif, gempa, cuaca negeri, waktu solat dan fakta', async ({ page }) => {
    const calls = await mockAll(page);
    await openApp(page, undefined, '#malaysia');
    await expect(page.locator('#my-today')).toContainText('waktu Malaysia (UTC+8)');

    await expect(page.locator('#my-warnings .alert')).toHaveCount(1);
    await expect(page.locator('#my-warnings')).toContainText('Amaran Hujan Lebat (Waspada)');
    await expect(page.locator('#my-quakes .alert')).toHaveCount(1);
    await expect(page.locator('#my-quakes .alert h4')).toHaveText('Magnitud 5.1: Laut Sulawesi');

    await expect(page.locator('#my-weather tbody th')).toHaveText(['Penang', 'Selangor', 'WP Kuala Lumpur']); // today only, in "Lihat jadual"

    // The tile map: 16 states; with no zone chosen, Kuala Lumpur is shown first.
    const tiles = page.locator('#my-tiles .state-tile');
    await expect(tiles).toHaveCount(16);
    await expect(page.locator('#my-tiles [aria-pressed="true"] .tile-code')).toHaveText('KUL');
    const sgr = tiles.filter({ hasText: 'SGR' });
    await expect(sgr).toHaveAttribute('aria-label', 'Selangor, Ribut petir di beberapa tempat, amaran Waspada');
    await expect(sgr.locator('.level-segs.level-alert .on')).toHaveCount(1); // Waspada: one segment of three
    await expect(tiles.filter({ hasText: 'PNG' }).locator('svg')).toHaveAttribute('data-glyph', 'fog'); // Berjerebu
    await sgr.click();
    await expect(sgr).toHaveAttribute('aria-pressed', 'true');
    await expect(sgr).toBeFocused(); // the tiles are not rebuilt by a choice
    const detail = page.locator('#my-state');
    await expect(detail.locator('h3')).toHaveText('Selangor Shah Alam');
    await expect(detail.locator('.state-next')).toHaveText('Zohor dalam 7j 10m (13:10, Shah Alam)');
    await expect(detail.locator('.state-days li')).toHaveText([/Hari ini.*Ribut petir/, /Esok.*Hujan di satu dua tempat/, /Jumaat.*tiada ramalan/]);
    await expect(detail.locator('.state-alert')).toHaveText(['Amaran Hujan Lebat (Waspada)Tahap: Waspada']);
    await detail.getByRole('button', { name: 'Lihat daerah dalam senarai amaran' }).click();
    await expect(page.locator('#alert-search')).toHaveValue('Selangor');
    await expect(page.locator('#alert-search')).toBeFocused();

    const rows = page.locator('#my-prayers tbody tr');
    await expect(rows).toHaveCount(16);
    await expect(rows.first().locator('td')).toHaveText(['05:55', '07:05', '13:10', '16:20', '19:12', '20:22']);
    await expect(rows.first().locator('td.next')).toHaveText('13:10'); // 06:00 now, so Zohor is next

    await expect(page.locator('#my-facts tbody tr')).toHaveCount(16);
    await expect(page.locator('#my-facts tbody tr').first().locator('th')).toHaveText('Selangor'); // most populous first
    await expect(page.locator('#my-facts tfoot')).toContainText(/34[.,]2/);

    // data.gov.my allows 4 requests a minute: one each for warnings, earthquakes and all states.
    expect(calls.dataGov).toHaveLength(3);
    await expect(page.locator('#ramadan')).toBeHidden(); // not Ramadan in this month's data
  });

  test('tab Bandar: 16 ibu negeri dengan foto, kredit, cuaca negeri dan solat seterusnya', async ({ page }) => {
    const calls = await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    const cards = page.locator('.city-card');
    await expect(cards).toHaveCount(16);
    const byCapital = (name) => cards.filter({ has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) });

    await expect(byCapital('Johor Bahru').locator('img')).toHaveAttribute('src', 'https://upload.wikimedia.org/test/0.png');
    await expect(byCapital('Johor Bahru').locator('.photo-credit')).toHaveText('Foto: Jane Doe, CC BY-SA 4.0, Wikimedia Commons');
    await expect(byCapital('Kangar').locator('img')).toHaveCount(1); // reached through a redirect
    await expect(byCapital('Kuala Lumpur').locator('.city-now')).toContainText('Tiada hujan');
    await expect(byCapital('Kuala Lumpur').locator('.city-now')).toContainText('Zohor 13:10');
    await expect(byCapital('George Town').locator('.city-now')).toContainText('Berjerebu');
    expect(calls.wiki).toBe(2); // all 16 photos and credits in two batched requests
    // data.gov.my allows 4 requests a minute: all states, every location today, and warnings.
    expect(calls.dataGov).toHaveLength(3);

    await byCapital('Kuala Lumpur').locator('.city-open').click();
    const dialog = page.locator('#city-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('Kuala Lumpur');
    await expect(dialog.locator('.prayer-times li')).toHaveCount(6);
    await expect(dialog.locator('.forecast dd').nth(1)).toHaveText('Hujan di satu dua tempat');
    await expect(dialog.locator('.local-link')).toHaveAttribute('href', 'https://eqms.doe.gov.my/');
    await dialog.getByRole('button', { name: 'Tutup' }).click();
    await expect(dialog).toBeHidden();
  });

  test('amaran MET: pendua dibuang, daerah ikut negeri, teks penuh kekal terbuka', async ({ page }) => {
    const repeated = { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Ribut Petir' }, valid_to: '2026-10-14T18:00:00', text_bm: longWarning };
    await mockAll(page, { warningRows: [repeated, { ...repeated, warning_issue: { ...repeated.warning_issue, issued: '2026-10-14T04:00:00' } }, ...warnings] });
    await openApp(page, undefined, '#malaysia');
    const alerts = page.locator('#my-warnings .alert');
    await expect(alerts).toHaveCount(2); // the repeat and the expired warning are gone
    const storm = alerts.first();
    // When, then each state with its districts, read out of MET's paragraph.
    await expect(storm.locator('.alert-period')).toHaveText('sehingga jam 6:00 petang');
    await expect(storm.locator('.alert-area h5')).toHaveText(['Perak', 'Pahang', 'Selangor']);
    await expect(storm.locator('.alert-area').first().locator('li')).toHaveText(['Hulu Perak', 'Kuala Kangsar', 'Kinta']);
    // MET's own words stay one click away, and stay open through the minute's refresh.
    await storm.getByText('Teks penuh MET').click();
    await expect(storm.locator('.alert-more p')).toHaveText(longWarning);
    await page.clock.runFor(61_000);
    await expect(storm.locator('.alert-more p')).toBeVisible();
    // A warning naming a state and no districts covers the whole state.
    await expect(alerts.nth(1).locator('.alert-area h5')).toHaveText('Seluruh negeri');
    await expect(alerts.nth(1).locator('.place-chips li')).toHaveText('Selangor');
  });

  // MET's own texts of 7 November 2026 (api.data.gov.my), shortened where they repeat.
  test('amaran MET sebenar: laut ikut seksyen, Negeri Sembilan dibaca, "Tiada Nasihat" tidak dipapar', async ({ page }) => {
    const sea = { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Angin Kencang dan Laut Bergelora' }, heading_bm: 'AMARAN ANGIN KENCANG DAN LAUT BERGELORA KATEGORI PERTAMA', valid_to: '2026-10-16T23:59:59',
      text_bm: 'SEKSYEN A: UNTUK PERAIRAN MALAYSIA [DALAM LINGKUNGAN 24 BATU NAUTIKA] 1) AMARAN RIBUT PETIR Ribut petir, hujan lebat dan angin kencang dijangka di kawasan perairan Perlis & Kedah • Pulau Pinang • Sabah Barat dan Labuan sehingga 10:00 Malam; Sabtu, 7 November 2026. Keadaan ini boleh menyebabkan angin kencang sehingga 50 kmsj dan laut bergelora dengan ombak mencapai ketinggian 3.5 meter dan berbahaya kepada bot-bot kecil. SEKSYEN B: UNTUK PERKAPALAN 1) AMARAN ANGIN KENCANG DAN LAUT BERGELORA (KATEGORI PERTAMA) Angin kencang timur laut berkelajuan 40 - 50 kmsj dengan ombak mencapai ketinggian sehingga 3.5 meter dijangka di kawasan perairan Condore • Reef North dalam tempoh Ahad, 8 November 2026 sehingga Selasa, 10 November 2026. Keadaan angin kencang dan laut bergelora ini adalah berbahaya kepada bot-bot kecil, rekreasi laut dan sukan laut. 2) AMARAN RIBUT PETIR Ribut petir, hujan lebat dan angin kencang dijangka di kawasan perairan Samui • Utara Tioman sehingga 10:00 Malam; Sabtu, 7 November 2026. Keadaan ini boleh menyebabkan angin kencang sehingga 50 kmsj.' };
    const storm = { warning_issue: { issued: '2026-10-14T05:30:00', title_bm: 'Amaran Ribut Petir' }, heading_bm: 'AMARAN RIBUT PETIR', valid_to: '2026-10-14T21:00:00',
      text_bm: 'Ribut petir, hujan lebat dan angin kencang dijangka di negeri Kedah (Yan dan Kulim) • Pulau Pinang • W.P. Kuala Lumpur • Negeri Sembilan • Sarawak: Miri, Sri Aman (Pantu dan Lingga), Kuching (Kuching dan Bau) • Sabah: Pedalaman (Beaufort dan Tenom), Pantai Barat (Ranau) • W.P. Labuan sehingga 9:00 Malam; Sabtu, 7 November 2026.' };
    const none = { warning_issue: { issued: '2026-10-14T05:40:00', title_bm: 'Tiada Nasihat' }, heading_bm: 'Tiada Nasihat', valid_to: null,
      text_bm: 'Tiada sistem Siklon Tropika dicerap di dalam kawasan pemantauan MMD (Latitud: 0-20 Utara & Longitud: 95-130 Timur)' };
    await mockAll(page, { warningRows: [sea, storm, none] });
    await openApp(page, undefined, '#malaysia');
    const alerts = page.locator('#my-warnings .alert');
    await expect(alerts).toHaveCount(2); // no "Tiada Nasihat": it says there is no cyclone
    await expect(page.locator('#my-warnings')).not.toContainText('Siklon');

    const seaCard = alerts.first();
    await expect(seaCard.locator('.level-tag')).toHaveCount(0); // MET names no level here
    await expect(seaCard.locator('.alert-section')).toHaveText(['Untuk perairan Malaysia (dalam lingkungan 24 batu nautika)', 'Untuk perkapalan']);
    await expect(seaCard.locator('.alert-item')).toHaveText(['Ribut petir', 'Angin kencang dan laut bergelora (kategori pertama)', 'Ribut petir']);
    await expect(seaCard.locator('.alert-area').first().locator('li')).toHaveText(['Perlis & Kedah', 'Pulau Pinang', 'Sabah Barat dan Labuan']);
    await expect(seaCard.locator('.alert-area').nth(1).locator('.alert-period')).toHaveText('Ahad, 8 November 2026 sehingga Selasa, 10 November 2026');

    const stormCard = alerts.nth(1);
    await expect(stormCard.locator('.level-tag')).toHaveCount(0); // "Amaran Ribut Petir" names no level: no made-up "Waspada"
    await expect(stormCard.locator('.alert-period')).toHaveText('sehingga 9:00 Malam; Sabtu, 7 November 2026');
    await expect(stormCard.locator('.alert-area h5')).toHaveText(['Kedah', 'Sarawak', 'Sabah', 'Seluruh negeri']);
    await expect(stormCard.locator('.alert-area').nth(1).locator('li')).toHaveText(['Miri', 'Sri Aman: Pantu, Lingga', 'Kuching: Kuching, Bau']);
    await expect(stormCard.locator('.alert-area').last().locator('li')).toHaveText(['Pulau Pinang', 'Kuala Lumpur', 'Negeri Sembilan', 'Labuan']);

    // Sea areas are searchable too.
    await page.getByLabel('Semak kawasan anda').fill('Tioman');
    await expect(seaCard.locator('li.is-match')).toHaveText('Utara Tioman');
    await expect(stormCard).toHaveClass(/is-folded/);
  });

  test('amaran MET: teks yang tidak dapat dibaca kekal sebagai ringkasan dengan "Baca penuh"', async ({ page }) => {
    const sea = { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Laut Bergelora' }, valid_to: '2026-10-15T00:00:00',
      text_bm: 'Angin kencang dan laut bergelora dijangka berlaku di perairan Sarawak dan Labuan: ombak setinggi 4.5 meter boleh membahayakan semua aktiviti perkapalan dan pantai.' };
    await mockAll(page, { warningRows: [sea] });
    await openApp(page, undefined, '#malaysia');
    const alert = page.locator('#my-warnings .alert');
    await expect(alert.locator('.alert-area')).toHaveCount(0); // waters, not states: no state list made up
    await expect(alert.locator('> p').first()).toHaveText('Angin kencang dan laut bergelora dijangka berlaku di perairan Sarawak dan Labuan');
    await alert.getByText('Baca penuh').click();
    await expect(alert.getByText(/ombak setinggi/)).toBeVisible();
  });

  test('amaran MET: pemecah teks membaca bahagian, tempoh, negeri dan daerah', async ({ page }) => {
    await mockAll(page);
    await openApp(page, undefined, '#malaysia');
    const read = await page.evaluate(async () => {
      const { warningPlaces } = await import('./js/warnings.js');
      return {
        sections: warningPlaces('AMARAN HUJAN BERTERUSAN (WASPADA) I) Hujan berterusan dijangka berlaku di negeri Kelantan (Tumpat, Kota Bharu dan Pasir Puteh) • Terengganu (Besut dan Setiu) dalam tempoh Ahad, 8 November 2026 sehingga Rabu, 11 November 2026. II) Hujan berterusan dijangka berlaku di negeri Sabah: Kudat, Sandakan (Paitan, Labuk & Sugut dan Kinabatangan) dalam tempoh Isnin, 9 November 2026 sehingga Rabu, 11 November 2026.'),
        list: warningPlaces('Ribut petir dijangka berlaku di Perlis, Kedah, Pulau Pinang dan Perak sehingga 9 malam.'),
        odd: warningPlaces('Sila rujuk laman web MET Malaysia untuk butiran.'),
      };
    });
    expect(read.sections).toEqual([
      { period: 'Ahad, 8 November 2026 sehingga Rabu, 11 November 2026', areas: [
        { state: 'Kelantan', places: [{ name: 'Tumpat', within: [] }, { name: 'Kota Bharu', within: [] }, { name: 'Pasir Puteh', within: [] }] },
        { state: 'Terengganu', places: [{ name: 'Besut', within: [] }, { name: 'Setiu', within: [] }] },
      ] },
      { period: 'Isnin, 9 November 2026 sehingga Rabu, 11 November 2026', areas: [
        { state: 'Sabah', places: [{ name: 'Kudat', within: [] }, { name: 'Sandakan', within: ['Paitan', 'Labuk & Sugut', 'Kinabatangan'] }] },
      ] },
    ]);
    expect(read.list).toEqual([{ period: 'sehingga 9 malam', areas: ['Perlis', 'Kedah', 'Pulau Pinang', 'Perak'].map((state) => ({ state, places: [] })) }]);
    expect(read.odd).toBeNull();
  });

  test('semak kawasan anda: daerah diserlah, amaran lain dilipat, negeri sahaja tetap terbuka', async ({ page }) => {
    const rain = { warning_issue: { issued: '2026-10-14T04:00:00', title_bm: 'Amaran Hujan Berterusan' }, valid_to: '2026-10-16T00:00:00',
      text_bm: 'Hujan berterusan dijangka berlaku di negeri Kelantan (Tumpat, Kota Bharu dan Pasir Puteh) • Terengganu (Besut dan Setiu) dalam tempoh Rabu, 14 Oktober 2026 sehingga Jumaat, 16 Oktober 2026.' };
    await mockAll(page, { warningRows: [rain, ...warnings] });
    await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'KTN01' }, '#malaysia');
    const alerts = page.locator('#my-warnings .alert');
    const search = page.getByLabel('Semak kawasan anda');
    const status = page.locator('#alert-search-status');
    await expect(alerts.first().locator('.alert-area').first()).toContainText('negeri zon anda'); // KTN01 is in Kelantan

    await search.fill('kota bharu');
    await expect(alerts.first().locator('li.is-match')).toHaveText('Kota Bharu');
    await expect(alerts.nth(1)).toHaveClass(/is-folded/); // the Selangor warning
    await expect(alerts.nth(1).locator('.place-chips')).toBeHidden();
    await expect(status).toHaveText('"kota bharu" disebut dalam 1 amaran.');

    // Machang is in Kelantan (JAKIM's zones) but not in this warning's list: it stays open to check.
    await search.fill('Machang');
    await expect(alerts.first()).not.toHaveClass(/is-folded/);
    await expect(alerts.first().locator('li.is-match')).toHaveCount(0);
    await expect(status).toHaveText('"Machang" tidak disebut, tetapi negerinya ada dalam 1 amaran. Semak senarai daerah di bawah.');

    // A whole-state warning counts for any place in that state.
    await search.fill('Shah Alam');
    await expect(alerts.nth(1).locator('li.is-match')).toHaveText('Selangor');
    await expect(alerts.first()).toHaveClass(/is-folded/);

    await search.fill('Kuching');
    await expect(status).toHaveText('Tiada amaran aktif yang menyebut "Kuching" atau negerinya.');
    await search.fill('');
    await expect(page.locator('#my-warnings .alert.is-folded')).toHaveCount(0);
    await expect(status).toBeHidden();
  });

  test('IPU anggaran: 100 = piawai 24 jam, kategori JAS, hanya 24 jam terakhir', async ({ page }) => {
    await mockAll(page);
    await openApp(page);
    const result = await page.evaluate(async ([nowS]) => {
      const { estimateAirIndex } = await import('./js/air.js');
      const series = (pm25, pm10, hours = 24) => {
        const time = Array.from({ length: hours }, (_, i) => nowS - i * 3600);
        return { time, pm2_5: time.map(() => pm25), pm10: time.map(() => pm10) };
      };
      const pick = (e) => (e ? `${e.index} ${e.band.label}` : null);
      return {
        pm25At50: pick(estimateAirIndex(series(17.5, 0), nowS * 1000)),
        pm25At51: pick(estimateAirIndex(series(17.85, 0), nowS * 1000)),
        pm10At100: pick(estimateAirIndex(series(0, 100), nowS * 1000)),
        pm10At101: pick(estimateAirIndex(series(0, 101), nowS * 1000)),
        at200: pick(estimateAirIndex(series(70, 0), nowS * 1000)),
        at201: pick(estimateAirIndex(series(0, 201), nowS * 1000)),
        at300: pick(estimateAirIndex(series(0, 300), nowS * 1000)),
        at301: pick(estimateAirIndex(series(0, 301), nowS * 1000)),
        worseWins: pick(estimateAirIndex(series(35, 50), nowS * 1000)),
        eighteenHours: pick(estimateAirIndex(series(7, 10, 18), nowS * 1000)),
        seventeenHours: pick(estimateAirIndex(series(7, 10, 17), nowS * 1000)),
        noData: pick(estimateAirIndex(undefined, nowS * 1000)),
      };
    }, [NOW_S]);
    expect(result).toEqual({
      pm25At50: '50 Baik', pm25At51: '51 Sederhana', pm10At100: '100 Sederhana', pm10At101: '101 Tidak sihat',
      at200: '200 Tidak sihat', at201: '201 Sangat tidak sihat', at300: '300 Sangat tidak sihat', at301: '301 Berbahaya',
      worseWins: '100 Sederhana', eighteenHours: '20 Baik', seventeenHours: null, noData: null,
    });
  });

  test('peta: penanda 16 ibu negeri dengan foto, cuaca dan IPU anggaran; klik membuka butiran', async ({ page }) => {
    const calls = await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    const markers = page.locator('.map-marker');
    await expect(markers).toHaveCount(33); // 16 capitals and 17 towns
    const marker = (capital) => markers.filter({ has: page.getByRole('button', { name: new RegExp(`^Butiran ${capital},`), includeHidden: true }) });

    const kl = marker('Kuala Lumpur');
    await expect(kl.locator('.marker-photo img')).toHaveAttribute('src', 'https://upload.wikimedia.org/test/13.png');
    await expect(kl.locator('.marker-weather svg')).toHaveAttribute('data-glyph', 'sun-cloud'); // "Tiada hujan" for WP Kuala Lumpur
    await expect(kl.locator('.marker-aqi')).toHaveText('120');
    await expect(kl).toHaveAttribute('data-aqi', 'unhealthy');
    await expect(marker('George Town').locator('.marker-weather svg')).toHaveAttribute('data-glyph', 'fog');
    await expect(marker('Kuching').locator('.marker-aqi')).toHaveText('160'); // PM10 decides here
    await expect(marker('Johor Bahru').locator('.marker-aqi')).toHaveText('20');
    await expect(marker('Johor Bahru')).toHaveAttribute('data-aqi', 'good');
    await expect(marker('Labuan').locator('.marker-aqi')).toHaveText(''); // not enough hours
    await expect(page.locator('#map-status')).toBeHidden();

    // One request for all 16 capitals and 17 towns.
    expect(calls.air).toHaveLength(1);
    expect(new URL(calls.air[0]).searchParams.get('latitude').split(',')).toHaveLength(33);

    // Putrajaya sits under Kuala Lumpur at country zoom; "+n" zooms in.
    await expect(marker('Putrajaya')).toHaveClass(/is-covered/);
    await expect(kl).not.toHaveClass(/is-covered/);
    const covered = await page.locator('.map-marker.is-covered').count();
    await kl.locator('.marker-more').click();
    await expect(page.locator('#my-map')).toHaveClass(/map-labelled/);
    await expect.poll(() => page.locator('.map-marker.is-covered').count()).toBeLessThan(covered);
    await expect(kl.locator('.marker-meta')).toHaveText('33°C · Zohor 13:10');
    await expect(kl.locator('.marker-meta svg')).toHaveAttribute('data-glyph', 'mosque');

    await kl.locator('.marker-open').click();
    const dialog = page.locator('#city-dialog');
    await expect(dialog.locator('h2')).toHaveText('Kuala Lumpur');
    await expect(dialog.locator('.aqi-reading')).toHaveText('120 Tidak sihat');
    await expect(dialog.getByText(/PM2\.5 42 µg\/m³, PM10 30 µg\/m³.*Bukan IPU rasmi JAS/)).toBeVisible();
    await expect(dialog.locator('.local-source')).toContainText('Open-Meteo');
    await dialog.getByRole('button', { name: 'Tutup' }).click();

    const card = page.locator('.city-card', { has: page.locator('h3', { hasText: /^Kuala Lumpur$/ }) });
    await expect(card.locator('.city-aqi')).toHaveText('IPU anggaran 120, Tidak sihat');
  });

  test('amaran dan gempa kosong: cip kecil bertanda', async ({ page }) => {
    await mockAll(page, { warningRows: [] });
    await page.route('https://api.data.gov.my/weather/warning/earthquake**', (route) => route.fulfill({ json: [], headers: { 'Access-Control-Allow-Origin': '*' } }));
    await openApp(page, undefined, '#malaysia');
    for (const [box, text] of [['#my-warnings', 'Tiada amaran cuaca aktif'], ['#my-quakes', 'Tiada laporan gempa bumi']]) {
      const chip = page.locator(`${box} .empty-chip`);
      await expect(chip).toHaveText(text);
      await expect(chip.locator('svg')).toHaveAttribute('data-glyph', 'check');
      expect(await chip.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(300); // a chip, not a full-width row
    }
  });

  test('peta: nama ringkas pada penanda sebelum zum; legenda terbuka di desktop', async ({ page }) => {
    await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    const kl = page.locator('.map-marker', { has: page.getByRole('button', { name: /^Butiran Kuala Lumpur,/, includeHidden: true }) });
    await expect(kl.locator('.marker-label strong')).toBeVisible();
    await expect(kl.locator('.marker-label strong')).toHaveText('Kuala Lumpur');
    await expect(kl.locator('.marker-meta')).toBeHidden();
    await expect(page.locator('#map-legend')).toHaveAttribute('open', '');
  });

  test.describe('di telefon', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('jadual negeri: lajur negeri kekal semasa diskrol; legenda peta dilipat', async ({ page }) => {
      await mockAll(page);
      await openApp(page, undefined, '#malaysia');
      await page.locator('.my-tables > summary').click(); // the tables are folded under "Lihat jadual"
      const scroller = page.locator('#my-prayers').locator('xpath=..');
      const first = page.locator('#my-prayers tbody th').first();
      const before = await first.evaluate((el) => el.getBoundingClientRect().left);
      await scroller.evaluate((el) => { el.scrollLeft = 200; });
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0); // it does scroll on a phone
      expect(await first.evaluate((el) => el.getBoundingClientRect().left)).toBe(before);

      await page.getByRole('link', { name: 'Bandar Malaysia' }).click();
      await expect(page.locator('#map-legend')).not.toHaveAttribute('open', '');
      await page.locator('#map-legend summary').click();
      await expect(page.locator('#map-legend li').first()).toBeVisible();
    });
  });

  test('peta: bandar tambahan tidak dikira dalam "+n" sebelum zum masuk', async ({ page }) => {
    await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    await expect(page.locator('.map-marker')).toHaveCount(33);
    await expect(page.locator('.map-marker.town:not(.is-covered)')).toHaveCount(0);
    // Every capital is either shown or counted in a "+n"; towns are neither.
    const shown = await page.locator('.map-marker:not(.town):not(.is-covered)').count();
    const folded = await page.locator('.marker-more:not([hidden])').evaluateAll((els) => els.reduce((n, b) => n + Number(b.textContent.slice(1)), 0));
    expect(shown + folded).toBe(16);

    // Towns get today's MET forecast from one request, under MET's own spelling too.
    const town = (name) => page.locator('.map-marker', { has: page.getByRole('button', { name: new RegExp(`^Butiran ${name},`), includeHidden: true }) });
    await expect(town('Sandakan').locator('.marker-weather svg')).toHaveAttribute('data-glyph', 'storm');
    await expect(town('Sandakan').locator('.marker-aqi')).toHaveText('57');
    await expect(town('Kluang').locator('.marker-weather svg')).toHaveAttribute('data-glyph', 'fog'); // MET calls it Keluang
    await expect(town('Miri').locator('.marker-weather')).toHaveText(''); // no forecast for it today
  });

  test('dialog: ramalan 3 hari, graf IPU 24 jam dan arah kiblat', async ({ page }) => {
    await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    await page.locator('.city-card', { has: page.locator('h3', { hasText: /^Kuala Lumpur$/ }) }).locator('.city-open').click();
    const dialog = page.locator('#city-dialog');
    await expect(dialog.locator('.forecast-days li')).toHaveText(['EsokRibut petir di beberapa tempat24–33°C', 'LusaTiada hujan24–33°C']);
    expect(await dialog.locator('.forecast-days svg').evaluateAll((icons) => icons.map((i) => i.dataset.glyph))).toEqual(['storm', 'sun-cloud']);
    const chart = dialog.locator('.aqi-chart');
    await expect(chart.locator('.aqi-bar')).toHaveCount(24);
    await expect(chart.locator('table tr')).toHaveCount(24); // the same hours as text
    await expect(chart.locator('table tr').last()).toHaveText('06:00120, Tidak sihat');
    await chart.locator('.aqi-hit').last().hover();
    await expect(chart.locator('.aqi-readout')).toHaveText('06:00 · IPU 120, Tidak sihat');
    await expect(dialog.locator('.qibla p')).toHaveText('293° dari utara (barat laut) · 6,974 km ke Kaabah');
  });

  test('peta: amaran darat diwarnakan ikut negeri; amaran laut tidak', async ({ page }) => {
    const rain = { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Hujan Berterusan (Buruk)' }, valid_to: '2026-10-15T00:00:00', text_bm: 'Hujan berterusan dijangka di kawasan berikut: Perak (Hulu Perak); Pahang (Raub).' };
    const storm = { warning_issue: { issued: '2026-10-14T04:00:00', title_bm: 'Amaran Ribut Petir' }, valid_to: '2026-10-15T00:00:00', text_bm: 'Ribut petir di kawasan berikut: Selangor (Gombak); Perak (Kinta).' };
    const sea = { warning_issue: { issued: '2026-10-14T03:00:00', title_bm: 'Amaran Angin Kencang dan Laut Bergelora' }, valid_to: '2026-10-15T00:00:00', text_bm: 'Angin kencang di perairan Sabah.' };
    await mockAll(page, { warningRows: [rain, storm, sea] });
    await openApp(page, undefined, '#bandar-malaysia');
    const list = page.locator('#map-warnings li');
    await expect(list).toHaveText(['Amaran Hujan Berterusan (Buruk): Pahang, Perak', 'Amaran Ribut Petir: Perak, Selangor']);
    const levels = await page.evaluate(async (rows) => (await import('./js/warnings.js')).warningLevels(rows), [rain, storm, sea]);
    expect(levels).toEqual({ Perak: 'severe', Pahang: 'severe', Selangor: 'alert' }); // the worst level wins; the sea colours nothing
    const danger = await page.evaluate(async (w) => (await import('./js/warnings.js')).warningLevels([w]), { ...rain, warning_issue: { title_bm: 'Amaran Hujan Berterusan (Bahaya)' } });
    expect(danger).toEqual({ Perak: 'danger', Pahang: 'danger' });
  });

  test('Ramadan: kiraan detik ke berbuka, ikut negeri, dan baris dalam panel solat', async ({ page }) => {
    await mockAll(page, { prayers: ramadanMonth });
    await openApp(page, undefined, '#malaysia');
    const section = page.locator('#ramadan');
    await expect(section).toBeVisible();
    await expect(section.locator('.ramadan-day')).toHaveText('Ramadan hari ke-5, 1448H');
    await expect(section.locator('.ramadan-label')).toHaveText('Berbuka di Kuala Lumpur dalam'); // 06:00, after imsak at 05:45
    await expect(section.locator('.ramadan-timer')).toHaveText('13:11:52'); // to 19:12:00 from 06:00:08
    await page.clock.runFor(1000);
    await expect(section.locator('.ramadan-timer')).toHaveText('13:11:51');
    await expect(section.locator('tbody tr')).toHaveCount(16);
    await expect(section.locator('tbody tr').first().locator('td')).toHaveText(['05:45', '19:12']);
    await section.getByRole('combobox').selectOption('Sabah');
    await expect(section.locator('.ramadan-label')).toHaveText('Berbuka di Kota Kinabalu dalam');

    await page.goto(`${APP_URL}#dunia`);
    await page.clock.runFor(1100);
    const kl = card(page, 'Asia/Kuala_Lumpur');
    await kl.getByRole('button', { name: 'Solat & cuaca' }).click();
    await expect(kl.locator('.ramadan-line')).toHaveText('Ramadan: imsak 05:45 · berbuka 19:12');
  });

  test.describe('peringatan waktu solat', () => {
    // A stand-in for the browser's Notification API that records what is shown.
    const fakeNotifications = (page, { permission = 'default', answer = 'granted' } = {}) => page.addInitScript(([p, a]) => {
      window.shown = [];
      window.Notification = class {
        static permission = p;
        static async requestPermission() { window.Notification.permission = a; return a; }
        constructor(title, options) { window.shown.push({ title, body: options.body, tag: options.tag }); }
      };
    }, [permission, answer]);
    const shown = (page) => page.evaluate(() => window.shown);

    test('hidupkan untuk zon dipilih, dapat notifikasi bila waktu solat tiba (sekali sahaja), dan matikan', async ({ page }) => {
      await fakeNotifications(page);
      await mockAll(page);
      await openApp(page, undefined, '#malaysia'); // 06:00, after Subuh at 05:55
      const box = page.locator('#prayer-reminder');
      // No zone yet: nothing to remind about.
      await expect(box.getByRole('button', { name: 'Ingatkan saya' })).toBeDisabled();
      await expect(box.getByRole('status')).toHaveText('Pilih zon anda di atas dahulu.');

      await page.getByLabel('Zon JAKIM').selectOption('WLY01');
      await box.getByRole('button', { name: 'Ingatkan saya' }).click();
      await expect(box.getByRole('status')).toHaveText('Peringatan aktif untuk zon WLY01 (Kuala Lumpur, Putrajaya).');
      await expect(box.getByRole('button', { name: 'Matikan peringatan' })).toHaveAttribute('aria-pressed', 'true');
      expect(await storedState(page)).toMatchObject({ prayerZone: 'WLY01', reminder: true });
      await page.clock.runFor(2000);
      expect(await shown(page)).toEqual([]); // Subuh had already passed

      await page.clock.fastForward('07:10:30'); // to 13:10:38, past Zohor at 13:10
      await page.clock.runFor(1100);
      expect(await shown(page)).toEqual([{ title: 'Waktu Zohor (WLY01)', body: '13:10 · Kuala Lumpur, Putrajaya · waktu JAKIM', tag: 'solat-dhuhr' }]);

      await page.clock.fastForward('06:20:00'); // past Asar (16:20) and Maghrib (19:12) at once: one notice
      await page.clock.runFor(1100);
      expect((await shown(page)).map((n) => n.title)).toEqual(['Waktu Zohor (WLY01)', 'Waktu Maghrib (WLY01)']);

      await box.getByRole('button', { name: 'Matikan peringatan' }).click();
      expect(await storedState(page)).toMatchObject({ prayerZone: 'WLY01', reminder: false });
      await page.clock.fastForward('01:20:00'); // past Isyak
      await page.clock.runFor(1100);
      expect(await shown(page)).toHaveLength(2);
    });

    test('peringatan ikut waktu zon yang dipilih, bukan zon lain', async ({ page }) => {
      await fakeNotifications(page, { permission: 'granted' });
      await mockAll(page);
      // Johor's Zohor is at 13:00, ten minutes before Kuala Lumpur's.
      await page.route('https://api.waktusolat.app/v2/solat/JHR01**', (route) => route.fulfill({
        json: { ...prayerMonth, zone: 'JHR01', prayers: prayerMonth.prayers.map((p) => ({ ...p, dhuhr: p.dhuhr - 600 })) },
        headers: { 'Access-Control-Allow-Origin': '*' },
      }));
      await openApp(page, undefined, '#malaysia');
      await page.getByLabel('Zon JAKIM').selectOption('JHR01');
      await page.locator('#prayer-reminder').getByRole('button', { name: 'Ingatkan saya' }).click();
      await page.clock.fastForward('07:00:23'); // to 13:00:30
      await page.clock.runFor(1100);
      expect((await shown(page)).map((n) => n.title)).toEqual(['Waktu Zohor (JHR01)']);
    });

    test('kosongkan zon mematikan peringatan', async ({ page }) => {
      await fakeNotifications(page, { permission: 'granted' });
      await mockAll(page);
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'WLY01', reminder: true }, '#malaysia');
      const box = page.locator('#prayer-reminder');
      await expect(box.getByRole('status')).toHaveText('Peringatan aktif untuk zon WLY01 (Kuala Lumpur, Putrajaya).');
      await page.getByLabel('Zon JAKIM').selectOption('');
      await expect(box.getByRole('status')).toHaveText('Pilih zon anda di atas dahulu.');
      await expect(box.getByRole('button', { name: 'Ingatkan saya' })).toBeDisabled();
      expect(await storedState(page)).toMatchObject({ prayerZone: null, reminder: false });
    });

    test('peringatan lama ikut negeri jadi zon ibu negerinya; tiada notifikasi untuk waktu yang lepas sebelum halaman dibuka', async ({ page }) => {
      await fakeNotifications(page, { permission: 'granted' });
      await mockAll(page);
      const prayerUrls = [];
      page.on('request', (req) => { if (req.url().includes('waktusolat')) prayerUrls.push(req.url()); });
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, reminder: { state: 'Sabah' } }, '#malaysia'); // 06:00, Subuh was 05:55
      await expect(page.getByLabel('Zon JAKIM')).toHaveValue('SBH07');
      await expect(page.locator('#prayer-reminder').getByRole('status')).toHaveText(/^Peringatan aktif untuk zon SBH07 \(Kota Kinabalu, /);
      expect(prayerUrls).toContain('https://api.waktusolat.app/v2/solat/SBH07?year=2026&month=10');
      await page.clock.runFor(2000);
      expect(await shown(page)).toEqual([]);
      await page.clock.fastForward('07:10:30');
      await page.clock.runFor(1100);
      expect((await shown(page)).map((n) => n.title)).toEqual(['Waktu Zohor (SBH07)']);
    });

    test('notifikasi disekat: mesej jelas, tiada peringatan disimpan', async ({ page }) => {
      await fakeNotifications(page, { answer: 'denied' });
      await mockAll(page);
      await openApp(page, undefined, '#malaysia');
      await page.getByLabel('Zon JAKIM').selectOption('WLY01');
      await page.locator('#prayer-reminder').getByRole('button', { name: 'Ingatkan saya' }).click();
      await expect(page.locator('#prayer-reminder').getByRole('status')).toHaveText(/^Notifikasi disekat\./);
      expect((await storedState(page)).reminder).toBe(false);
    });

    test('pelayar tanpa notifikasi: diterangkan, tiada butang', async ({ page }) => {
      await page.addInitScript(() => { delete window.Notification; });
      await mockAll(page);
      await openApp(page, undefined, '#malaysia');
      await expect(page.locator('#prayer-reminder')).toHaveText(/tidak menyokong notifikasi/);
      await expect(page.locator('#prayer-reminder button')).toHaveCount(0);
    });
  });

  test.describe('waktu solat zon anda', () => {
    test('jadual sebulan: bulan ini dan berikutnya, cetak, dan .ics dengan penggera', async ({ page }) => {
      // With the Hijri date and imsak the real API gives (14 October 2026 is 2 Jamadilawal 1448).
      await mockAll(page, { prayers: { ...prayerMonth, prayers: prayerMonth.prayers.map((p) => ({
        ...p, imsak: p.fajr - 600, hijri: `1448-${p.day < 13 ? '04' : '05'}-${String(p.day < 13 ? p.day + 18 : p.day - 12).padStart(2, '0')}`,
      })) } });
      const months = [];
      page.on('request', (req) => { if (req.url().includes('/v2/solat/WLY01')) months.push(new URL(req.url()).searchParams.get('month')); });
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'WLY01' }, '#malaysia');
      await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed += 1; }; });
      await page.getByRole('button', { name: 'Jadual sebulan' }).click();
      const dialog = page.getByRole('dialog', { name: 'Waktu solat Oktober 2026' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#month-zone')).toHaveText('WLY01 · Kuala Lumpur, Putrajaya, Wilayah Persekutuan');
      await expect(dialog.locator('thead th')).toHaveText(['Tarikh', 'Hijri', 'Imsak', 'Subuh', 'Syuruk', 'Zohor', 'Asar', 'Maghrib', 'Isyak']);
      await expect(dialog.locator('tbody tr')).toHaveCount(31);
      const today = dialog.locator('tbody tr[aria-current="date"]');
      await expect(today.locator('th')).toHaveText('14 Rab');
      await expect(today.locator('td').nth(0)).toHaveText('2 Jamadilawal');
      await expect(today.locator('td').nth(1)).toHaveText('05:45'); // imsak
      await expect(today.locator('td').nth(2)).toHaveText('05:55'); // Subuh, after Hijri and Imsak

      // Or subscribed: the zone's calendar that .github/workflows/pages.yml rebuilds daily.
      await expect(dialog.getByRole('link', { name: 'Langgan (Apple, Outlook)' })).toHaveAttribute('href', 'webcal://localhost:4173/kalendar/WLY01.ics');
      await expect(dialog.getByRole('link', { name: 'Langgan dalam Google Calendar' })).toHaveAttribute('href',
        'https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Flocalhost%3A4173%2Fkalendar%2FWLY01.ics');
      await dialog.getByRole('button', { name: 'Cetak' }).click();
      expect(await page.evaluate(() => window.printed)).toBe(1);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Muat turun .ics (dengan penggera)' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('waktu-solat-WLY01-2026-10.ics');
      const ics = require('node:fs').readFileSync(await download.path(), 'utf8').replace(/\r\n /g, '');
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(31 * 5); // five prayers a day; syuruk is not one
      expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(31 * 5);
      expect(ics).toContain('\r\nDTSTART:20260930T215500Z\r\nDTEND:20260930T220500Z\r\nSUMMARY:Subuh (WLY01)\r\n');
      expect(ics).toContain('\r\nTRIGGER:PT0S\r\n');

      await dialog.getByRole('button', { name: 'Bulan berikutnya' }).click();
      await expect(page.getByRole('dialog', { name: 'Waktu solat November 2026' })).toBeVisible();
      expect(months).toContain('11');
    });

    test('takwim Islam: tarikh Hijri JAKIM, hari kebesaran, puasa sunat dengan .ics, dan bulan', async ({ page }) => {
      await mockAll(page);
      // JAKIM's months: 14 October 2026 is 2 Jamadilawal 1448; imsak 05:45, berbuka 19:12.
      await page.route('https://api.waktusolat.app/v2/solat/**', (route) => {
        const url = new URL(route.request().url());
        const month = Number(url.searchParams.get('month'));
        const hijri = (day) => (month === 10
          ? (day < 13 ? `1448-04-${day + 18}` : `1448-05-${String(day - 12).padStart(2, '0')}`)
          : (day <= 10 ? `1448-05-${day + 19}` : `1448-06-${String(day - 10).padStart(2, '0')}`));
        const at2 = (day, hh, mm) => Date.UTC(2026, month - 1, day, hh - 8, mm) / 1000;
        return route.fulfill({
          json: {
            zone: url.pathname.split('/').pop(),
            prayers: Array.from({ length: month === 10 ? 31 : 30 }, (_, i) => ({
              day: i + 1, hijri: hijri(i + 1), imsak: at2(i + 1, 5, 45), fajr: at2(i + 1, 5, 55), syuruk: at2(i + 1, 7, 5),
              dhuhr: at2(i + 1, 13, 10), asr: at2(i + 1, 16, 20), maghrib: at2(i + 1, 19, 12), isha: at2(i + 1, 20, 22),
            })),
          },
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      });
      // Holy days as the holiday table has them (rows of our own: the real table moves on with the years).
      await page.route('**/js/my-holidays.js', (route) => route.fulfill({
        contentType: 'text/javascript',
        body: `export const MY_HOLIDAYS = ${JSON.stringify([
          ['2026-08-25', 'Hari Keputeraan Nabi Muhammad S.A.W.', null], ['2027-01-06', 'Israk dan Mikraj', ['Kedah']],
          ['2027-02-08', 'Awal Ramadan', ['Johor']], ['2027-03-10', 'Hari Raya Puasa', null], ['2027-03-11', 'Hari Raya Puasa (Hari Kedua)', null],
          ['2027-05-17', 'Hari Raya Qurban', null], ['2027-08-15', 'Hari Keputeraan Nabi Muhammad S.A.W.', null],
        ])};`,
      }));
      const modules = [];
      page.on('request', (req) => { if (req.url().endsWith('/js/takwim.js')) modules.push(req.url()); });
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'WLY01' });
      expect(modules).toEqual([]); // not on the world tab
      await page.click('.nav-links a[href="#malaysia"]');
      const takwim = page.locator('#takwim');
      await expect(takwim.locator('.takwim-hijri')).toHaveText('2 Jamadilawal 1448 H');
      expect(modules).toHaveLength(1);

      const holy = takwim.locator('.takwim-block').nth(1);
      await expect(holy.locator('.takwim-next')).toHaveText('Israk dan Mikraj dalam 84 hari');
      await expect(holy.locator('.takwim-list li')).toHaveText([
        'Awal Ramadan8 Feb 2027 · 117 hari', 'Hari Raya Aidilfitri10 Mac 2027 · 147 hari',
        'Hari Raya Aidiladha17 Mei 2027 · 215 hari', 'Maulidur Rasul15 Ogo 2027 · 305 hari',
      ]);

      const fasts = takwim.locator('.takwim-block').nth(2);
      await expect(fasts.locator('.takwim-list li')).toHaveText([
        'KhamisKha, 15 Okt · 3 Jamadilawal', 'IsninIsn, 19 Okt · 7 Jamadilawal', 'KhamisKha, 22 Okt · 10 Jamadilawal',
        'Ayyamul BidhAhd, 25 Okt · 13 Jamadilawal', 'Ayyamul Bidh, IsninIsn, 26 Okt · 14 Jamadilawal', 'Ayyamul BidhSel, 27 Okt · 15 Jamadilawal',
      ]);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        fasts.getByRole('button', { name: 'Muat turun .ics (penggera pada imsak)' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('puasa-sunat-WLY01-2026-10-14.ics');
      const ics = require('node:fs').readFileSync(await download.path(), 'utf8').replace(/\r\n /g, '');
      // Mondays and Thursdays to the end of November (14), and Ayyamul Bidh days that are neither (4).
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(18);
      expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(18);
      // From imsak (05:45) to berbuka (19:12), the alarm at imsak.
      expect(ics).toContain('\r\nUID:WLY01-2026-10-26-puasa@jam-dunia\r\nDTSTAMP:');
      expect(ics).toContain('\r\nDTSTART:20261025T214500Z\r\nDTEND:20261026T111200Z\r\nSUMMARY:Puasa sunat: Ayyamul Bidh\\, Isnin\r\n');
      expect(ics).toContain('\r\nTRIGGER:PT0S\r\n');
      expect(ics).toContain('UID:WLY01-2026-11-24-puasa@jam-dunia'); // 14 Jamadilakhir, a Tuesday

      const moon = takwim.locator('.takwim-moon');
      await expect(moon.locator('.takwim-phase')).toHaveText('Sabit muda · 11% bercahaya');
      // A waxing crescent: lit from the right edge, the shadow line bowing right too.
      expect(await moon.locator('.moon-lit').getAttribute('d')).toMatch(/^M22 2A20 20 0 0 1 22 42A[\d.]+ 20 0 0 0 22 2Z$/);
      await expect(moon.locator('p').nth(1)).toHaveText('Purnama: Isn, 26 Okt · Bulan baharu: Isn, 9 Nov');
      await expect(moon.locator('p').nth(2)).toHaveText('Hari ini di Kuala Lumpur: terbit 09:39 · terbenam 21:50');

      // Without a zone the list stays (JAKIM's date is the same nationwide), but not the .ics.
      await page.getByLabel('Zon JAKIM').selectOption('');
      await expect(fasts.getByRole('button', { name: 'Muat turun .ics (penggera pada imsak)' })).toBeDisabled();
      await expect(fasts.locator('.takwim-note')).toHaveText('Pilih zon anda di atas untuk fail .ics dengan waktu imsak dan berbuka zon anda.');
      await expect(takwim.locator('.takwim-hijri')).toHaveText('2 Jamadilawal 1448 H');
    });

    test('takwim: bulan di ibu negeri zon, dan Ramadan tiada puasa sunat', async ({ page }) => {
      await mockAll(page);
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'SBH07' }, '#malaysia');
      const names = await page.evaluate(async () => {
        const { sunatFasts } = await import('./js/islamic-days.js');
        return [
          sunatFasts({ month: 9, day: 14 }, 1), // a Monday in Ramadan
          sunatFasts({ month: 10, day: 1 }, 4), // Aidilfitri on a Thursday
          sunatFasts({ month: 12, day: 9 }, 2), // Arafah
          sunatFasts({ month: 12, day: 13 }, 1), // a day of Tasyrik, a Monday
          sunatFasts({ month: 1, day: 9 }, 3), sunatFasts({ month: 1, day: 10 }, 4),
          sunatFasts({ month: 10, day: 2 }, 5),
        ];
      });
      expect(names).toEqual([[], [], ['Hari Arafah'], [], ['Tasua'], ['Asyura', 'Khamis'], ['Enam Syawal']]);
      await expect(page.locator('#takwim .takwim-moon p').nth(2)).toContainText('Hari ini di Kota Kinabalu:');
    });

    test('amaran MET untuk negeri zon dipaparkan dalam kad zon', async ({ page }) => {
      const kl = { warning_issue: { issued: '2026-10-14T05:00:00', title_bm: 'Amaran Ribut Petir (Waspada)' }, valid_from: '2026-10-14T05:00:00', valid_to: '2026-10-15T00:00:00', text_bm: 'Ribut petir dijangka di Kuala Lumpur.' };
      await mockAll(page, { warningRows: [...warnings, kl] });
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'SGR01' }, '#malaysia');
      const alerts = page.locator('#zone-alerts .zone-alert');
      await expect(alerts).toHaveCount(1); // the Selangor warning
      await expect(alerts).toContainText('Amaran Hujan Lebat (Waspada)');
      await expect(alerts.getByRole('link', { name: 'Baca amaran' })).toHaveAttribute('href', '#my-alerts-title');
      // The level meter: segments filled to the level, and the level in words beside them.
      const head = page.locator('#zone-alerts .level-head');
      await expect(head).toHaveText('Waspada untuk Selangor');
      await expect(head.locator('.level-segs .on')).toHaveCount(1);
      await page.getByLabel('Zon JAKIM').selectOption('WLY01'); // MET names it Kuala Lumpur, not the zone's state
      await expect(alerts).toHaveText(['Amaran Ribut Petir (Waspada)Tahap: WaspadaBaca amaran']); // the level as a text label
      await expect(head).toHaveText('Waspada untuk Kuala Lumpur dan Putrajaya');
      await page.getByLabel('Zon JAKIM').selectOption('WLY02'); // Labuan: none in force
      await expect(alerts).toHaveCount(0);
      await expect(head).toHaveText('Tiada amaran untuk Labuan');
      await expect(head.locator('.level-segs .on')).toHaveCount(0);
    });

    test('pilih zon: waktu hari ini untuk zon itu, solat seterusnya ditanda, dan kekal selepas reload', async ({ page }) => {
      await mockAll(page);
      const prayerUrls = [];
      page.on('request', (req) => { if (req.url().includes('waktusolat')) prayerUrls.push(req.url()); });
      await openApp(page, undefined, '#malaysia'); // 06:00 Wednesday 14 October
      await expect(page.locator('#zone-times')).toHaveText(/Pilih zon anda/);
      // 60 zones, grouped by state.
      await expect(page.locator('#zone-select option')).toHaveCount(61);
      await expect(page.locator('#zone-select optgroup')).toHaveCount(14);
      await expect(page.locator('#zone-select optgroup[label="Selangor"] option')).toHaveText([
        'SGR01 · Gombak, Petaling, Sepang, Hulu Langat, Hulu Selangor, Shah Alam', 'SGR02 · Kuala Selangor, Sabak Bernam', 'SGR03 · Klang, Kuala Langat',
      ]);

      await page.getByLabel('Zon JAKIM').selectOption('SGR03');
      const times = page.locator('#zone-times');
      // What comes next, counted down; the zone itself is named in the picker.
      await expect(times.locator('.zone-next')).toHaveText('Zohor dalam 7j 10m (13:10)');
      await expect(times.locator('.zone-name')).toHaveCount(0);
      // The zone strip: six marks on the day, the next one flagged, the "now" line at 06:00 (a quarter of the way).
      const strip = times.locator('.zone-strip');
      await expect(strip.locator('.zone-mark')).toHaveCount(6);
      await expect(strip.locator('.zone-mark.next .zone-flag')).toHaveText('Zohor 13:10');
      await expect(strip.locator('.zone-mark.done')).toHaveCount(1); // 06:00: Subuh (05:55) is past
      expect(parseFloat(await strip.locator('.sun-now').evaluate((el) => el.style.left))).toBeCloseTo(25, 1);
      await expect(times.locator('li')).toHaveText(['Subuh05:55', 'Syuruk07:05', 'Zohor13:10 (seterusnya)', 'Asar16:20', 'Maghrib19:12', 'Isyak20:22']);
      await expect(times.locator('li.next span').first()).toHaveText('Zohor');
      expect(prayerUrls).toContain('https://api.waktusolat.app/v2/solat/SGR03?year=2026&month=10');
      expect(await storedState(page)).toMatchObject({ prayerZone: 'SGR03', reminder: false });

      const again = await page.context().newPage();
      await mockAll(again);
      await openApp(again, undefined, '#malaysia');
      await expect(again.getByLabel('Zon JAKIM')).toHaveValue('SGR03');
      await expect(again.locator('#zone-times .zone-next')).toHaveText('Zohor dalam 7j 10m (13:10)');
    });

    test.describe('dengan lokasi anda (Klang)', () => {
      test.use({ geolocation: { latitude: 3.0449, longitude: 101.4456 }, permissions: ['geolocation'] });

      test('guna lokasi saya: zon dicari dengan lokasi dibundarkan', async ({ page }) => {
        await mockAll(page);
        const lookups = [];
        await page.route('https://api.waktusolat.app/zones/**', (route) => {
          lookups.push(new URL(route.request().url()).pathname);
          route.fulfill({ json: { zone: 'SGR03', state: 'SGR', district: 'Klang' }, headers: { 'Access-Control-Allow-Origin': '*' } });
        });
        await openApp(page, undefined, '#malaysia');
        await page.getByRole('button', { name: 'Guna lokasi saya' }).click();
        await expect(page.locator('#zone-status')).toHaveText('Zon anda: SGR03 (Selangor).');
        expect(lookups).toEqual(['/zones/3.04/101.45']);
        await expect(page.getByLabel('Zon JAKIM')).toHaveValue('SGR03');
        await expect(page.locator('#zone-times .zone-next')).toHaveText('Zohor dalam 7j 10m (13:10)');
        expect((await storedState(page)).prayerZone).toBe('SGR03');
      });
    });

    test.describe('di luar Malaysia', () => {
      test.use({ geolocation: { latitude: 1.29, longitude: 103.85 }, permissions: ['geolocation'], expectedConsole: [/status of 500/] });

      test('zon tidak ditemui: mesej jelas, pilihan tidak berubah', async ({ page }) => {
        await mockAll(page);
        await page.route('https://api.waktusolat.app/zones/**', (route) => route.fulfill({
          status: 500, json: { error: 'No zone found for the given coordinates.' }, headers: { 'Access-Control-Allow-Origin': '*' },
        }));
        await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'WLY01' }, '#malaysia');
        await page.getByRole('button', { name: 'Guna lokasi saya' }).click();
        await expect(page.locator('#zone-status')).toHaveText(/^Zon JAKIM untuk lokasi anda tidak ditemui/);
        await expect(page.getByLabel('Zon JAKIM')).toHaveValue('WLY01');
        await expect(page.getByRole('button', { name: 'Guna lokasi saya' })).toBeEnabled();
      });
    });

    test('selepas Isyak: Subuh esok dikira detik; nota peringatan dilipat', async ({ page }) => {
      await mockAll(page);
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'WLY01' }, '#malaysia', new Date('2026-10-14T13:30:00Z')); // 21:30
      await expect(page.locator('#zone-times .zone-next')).toHaveText('Subuh esok dalam 8j 25m (05:55)');
      await expect(page.locator('#zone-times li.next')).toHaveCount(0);
      await page.clock.runFor(60 * 1000);
      await expect(page.locator('#zone-times .zone-next')).toHaveText('Subuh esok dalam 8j 24m (05:55)');

      const note = page.locator('#prayer-reminder .reminder-note');
      await expect(note.locator('summary')).toHaveText('Hanya berfungsi semasa Jam Dunia terbuka');
      await expect(note.getByText(/guna app azan/)).toBeHidden();
      await note.locator('summary').click();
      await expect(note.getByText(/guna app azan/)).toBeVisible();
    });

    test('zon tersimpan yang tidak sah diabaikan', async ({ page }) => {
      await mockAll(page);
      await openApp(page, { zones: ['Asia/Kuala_Lumpur'], hour24: true, prayerZone: 'XYZ99', reminder: true }, '#malaysia');
      await expect(page.getByLabel('Zon JAKIM')).toHaveValue('');
      await expect(page.locator('#prayer-reminder').getByRole('button', { name: 'Ingatkan saya' })).toBeDisabled();
    });
  });

  test.describe('kebolehcapaian', () => {
    // WCAG 2.1 A/AA and axe's best practices. Text over gradients, which axe
    // cannot measure, was checked by hand against the rendered backgrounds.
    const audit = async (page) => {
      await page.clock.resume(); // axe waits on timers of its own
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze();
      return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    };

    for (const scheme of ['light', 'dark']) {
      test(`tiada pelanggaran axe pada setiap tab dan dialog (${scheme})`, async ({ page }) => {
        test.setTimeout(60000); // several full audits, each a few seconds
        await page.emulateMedia({ colorScheme: scheme });
        await mockAll(page);
        await page.route('https://api.open-meteo.com/v1/forecast?**', (route) => route.fulfill({
          json: Array(4).fill({ current: { temperature_2m: 27, weather_code: 2, is_day: 1 } }), headers: { 'Access-Control-Allow-Origin': '*' },
        }));
        // A chosen zone and a picked planner hour, so their panels are audited too.
        const stored = { zones: ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Tokyo'], hour24: true, prayerZone: 'WLY01' };
        for (const hash of ['#dunia', '#malaysia', '#bandar-malaysia']) {
          await openApp(page, stored, hash);
          await expect(page.locator('.tab-panel:not([hidden]) h1')).toHaveCount(1);
          if (hash === '#dunia') {
            await page.click('#planner-table thead button[aria-label="Pilih 15:00 waktu anda"]');
            await expect(page.locator('#planner-pick')).toBeVisible();
            await expect(page.locator('.card .weather').first()).not.toBeEmpty();
            await page.locator('.card .weather-toggle').first().click(); // the hours strip, open
            await page.locator('.card[data-zone="Asia/Tokyo"] .local-toggle').click(); // prayer times worked out in the browser
            await expect(page.locator('.card[data-zone="Asia/Tokyo"] .prayer-times li')).toHaveCount(6);
            await page.locator('#countdowns').scrollIntoViewIfNeeded(); // the countdown form, loaded near the screen
            await expect(page.locator('.countdown-form')).toBeVisible();
            await expect(page.locator('.card .hourly:not([hidden])')).toHaveCount(1);
          }
          if (hash === '#malaysia') {
            await expect(page.locator('#zone-times li')).toHaveCount(6);
            await expect(page.locator('#takwim .takwim-moon')).toBeVisible(); // the Islamic calendar, loaded with the tab
            // Tables that scroll sideways can be reached and scrolled from the keyboard.
            await expect(page.locator('.table-scroll:has(#my-prayers)')).toHaveAttribute('tabindex', '0');
          }
          expect(await audit(page), hash).toEqual([]);
          if (hash === '#dunia') {
            await page.locator('.card[data-zone="Europe/London"] .person-edit').click();
            await expect(page.locator('#person-dialog')).toBeVisible();
            expect(await audit(page), 'dialog nama').toEqual([]);
            await page.keyboard.press('Escape');
          }
          if (hash === '#malaysia') {
            await page.getByRole('button', { name: 'Jadual sebulan' }).click();
            await expect(page.locator('#month-table tbody tr')).toHaveCount(31);
            expect(await audit(page), 'jadual sebulan').toEqual([]);
            await page.locator('#month-dialog .dialog-close button').click();
          }
        }
        await page.locator('.city-card').first().locator('.city-open').click();
        await expect(page.locator('#city-dialog .local-panel h3').first()).toBeVisible();
        expect(await audit(page), 'dialog bandar').toEqual([]);
      });
    }

    test('peta boleh digunakan dengan papan kekunci', async ({ page }) => {
      await mockAll(page);
      await openApp(page, undefined, '#bandar-malaysia');
      const kl = page.locator('#my-map').getByRole('button', { name: 'Butiran Kuala Lumpur, W.P. Kuala Lumpur' });
      await kl.focus();
      await expect(kl).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#city-dialog h2')).toHaveText('Kuala Lumpur');
      await page.keyboard.press('Escape');
      await expect(page.locator('#city-dialog')).toBeHidden();
      await expect(kl).toBeFocused(); // focus returns to the marker
    });

    test('pautan langkau pergi ke tajuk tab semasa tanpa menukar tab', async ({ page }) => {
      await mockAll(page);
      await openApp(page, undefined, '#malaysia');
      await page.getByRole('link', { name: 'Langkau ke kandungan' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#my-title')).toBeFocused();
      await expect(page.locator('#malaysia')).toBeVisible();
      expect(new URL(page.url()).hash).toBe('#malaysia');
    });
  });

  test.describe('dengan lokasi anda (Klang)', () => {
    test.use({ geolocation: { latitude: 3.0, longitude: 101.48 }, permissions: ['geolocation'] });

    test('bandar terdekat: zum ke bandar itu dan buka butirannya', async ({ page }) => {
      await mockAll(page);
      await openApp(page, undefined, '#bandar-malaysia');
      await page.getByRole('button', { name: 'Bandar terdekat' }).click();
      await expect(page.locator('#map-tools-status')).toHaveText('Bandar terdekat: Klang, Selangor (kira-kira 8 km dari anda).');
      const dialog = page.locator('#city-dialog');
      await expect(dialog.locator('h2')).toHaveText('Klang');
      await expect(dialog.locator('.city-state')).toHaveText('Selangor');
      await expect(dialog.locator('.dialog-photo')).toHaveCount(0); // towns have no landmark photo
      await expect(dialog.locator('.qibla p')).toHaveText('293° dari utara (barat laut) · 6,965 km ke Kaabah');
      await dialog.getByRole('button', { name: 'Tutup' }).click();
      await expect(page.locator('#my-map')).toHaveClass(/map-labelled/);
      await expect(page.locator('.map-marker', { has: page.getByRole('button', { name: /^Butiran Klang,/, includeHidden: true }) })).not.toHaveClass(/is-covered/);
    });

    test('bandar terdekat sebelum peta siap: peta tetap zum ke bandar itu bila ia siap', async ({ page }) => {
      await mockAll(page);
      // The map's code arrives late (it loads when the tab is first opened).
      await page.route('**/js/map.js', async (route) => {
        await new Promise((resolve) => { setTimeout(resolve, 1500); });
        await route.continue();
      });
      await openApp(page, undefined, '#bandar-malaysia');
      await page.getByRole('button', { name: 'Bandar terdekat' }).click();
      await expect(page.locator('#city-dialog h2')).toHaveText('Klang');
      await page.locator('#city-dialog').getByRole('button', { name: 'Tutup' }).click();
      await expect(page.locator('#my-map')).toHaveClass(/map-labelled/, { timeout: 15000 });
    });

    // Some browsers ask before sharing the compass (Safari, newer Chrome);
    // answer that prompt explicitly so the test does not depend on the browser.
    const answerSensorPrompt = (page, answer) => page.addInitScript((a) => {
      DeviceOrientationEvent.requestPermission = () => Promise.resolve(a);
    }, answer);

    test('kompas kiblat: arah dari lokasi anda, berpusing ikut sensor', async ({ page }) => {
      await answerSensorPrompt(page, 'granted');
      await mockAll(page);
      await openApp(page, undefined, '#bandar-malaysia');
      await page.getByRole('button', { name: 'Kompas kiblat' }).click();
      const dialog = page.locator('#qibla-dialog');
      await expect(dialog.locator('#qibla-reading')).toHaveText(/^293° dari utara \(barat laut\) · 6,9\d\d km ke Kaabah$/);
      await page.clock.runFor(3100);
      await expect(dialog.locator('#qibla-status')).toHaveText(/^Peranti ini tiada kompas\./);
      const turn = dialog.locator('.dial-turn');
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true })));
      await expect(turn).toHaveAttribute('transform', 'rotate(-270.0 50 50)'); // facing west: alpha 90 is heading 270
      await expect(dialog.locator('#qibla-status')).toHaveText('Pegang telefon mendatar. Anak panah menunjuk arah kiblat.');
      await dialog.getByRole('button', { name: 'Tutup' }).click();
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0, absolute: true })));
      await expect(turn).toHaveAttribute('transform', 'rotate(-270.0 50 50)'); // no longer listening once closed
    });

    test('kompas kiblat: tanpa kebenaran sensor, arah ditunjuk dari utara', async ({ page }) => {
      await answerSensorPrompt(page, 'denied');
      await mockAll(page);
      await openApp(page, undefined, '#bandar-malaysia');
      await page.getByRole('button', { name: 'Kompas kiblat' }).click();
      const dialog = page.locator('#qibla-dialog');
      await expect(dialog.locator('#qibla-reading')).toHaveText(/^293° dari utara/);
      await expect(dialog.locator('#qibla-status')).toHaveText('Anak panah menunjuk kiblat dari utara (U). Hadapkan "U" ke utara untuk mengikutnya.');
      await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true })));
      await expect(dialog.locator('.dial-turn')).not.toHaveAttribute('transform', /rotate/); // not listening without permission
    });
  });

  test('lokasi ditolak: mesej yang jelas', async ({ page }) => {
    // Headless Chromium leaves the permission prompt unanswered; answer it "no".
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (ok, fail) => fail({ code: 1, message: 'User denied Geolocation' });
    });
    await mockAll(page);
    await openApp(page, undefined, '#bandar-malaysia');
    await page.getByRole('button', { name: 'Bandar terdekat' }).click();
    await expect(page.locator('#map-tools-status')).toHaveText(/^Kebenaran lokasi ditolak\./);
  });

  test.describe('bila perkhidmatan luar gagal', () => {
    test.use({ expectedConsole: [/status of (500|429)/] });

    test('peta dan data udara gagal: mesej dipaparkan, senarai bandar masih berfungsi', async ({ page }) => {
      await mockAll(page, { styleStatus: 500, airStatus: 500 });
      await openApp(page, undefined, '#bandar-malaysia');
      await expect(page.locator('#map-status')).toHaveText(/Sebahagian peta tidak dapat dimuat/);
      await expect(page.locator('.city-card')).toHaveCount(16);
      await page.locator('.city-card').first().locator('.city-open').click();
      const air = page.locator('#city-dialog .local-block', { has: page.locator('h3', { hasText: 'Kualiti udara' }) });
      await expect(air).toContainText('Anggaran kualiti udara tidak dapat dimuat.');
      await expect(air.getByRole('button', { name: 'Cuba lagi' })).toBeVisible();
      await expect(air.locator('.local-link')).toHaveAttribute('href', 'https://eqms.doe.gov.my/');
    });

    test('tanpa WebGL: mesej dipaparkan, senarai bandar masih berfungsi', async ({ page }) => {
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
        };
      });
      await mockAll(page);
      await openApp(page, undefined, '#bandar-malaysia');
      await expect(page.locator('#map-status')).toHaveText(/tidak menyokong WebGL/);
      await expect(page.locator('.city-card')).toHaveCount(16);
    });

    test('foto gagal dimuat: nama landmark dipaparkan sebagai ganti', async ({ page }) => {
      await mockAll(page, { wikiStatus: 500 });
      await openApp(page, undefined, '#bandar-malaysia');
      const kl = page.locator('.city-card', { has: page.locator('h3', { hasText: /^Kuala Lumpur$/ }) });
      await expect(kl.locator('.photo-missing')).toHaveText('Menara Berkembar Petronas');
      await expect(kl.locator('img')).toHaveCount(0);
      // On the map, a two-letter abbreviation stands in for the photo.
      const marker = (name) => page.locator('.map-marker', { has: page.getByRole('button', { name: new RegExp(`^Butiran ${name},`), includeHidden: true }) });
      await expect(marker('Kuala Lumpur').locator('.marker-initial')).toHaveText('KL');
      await expect(marker('Ipoh').locator('.marker-initial')).toHaveText('Ip');
    });

    test('had permintaan data.gov.my diterangkan dengan jelas', async ({ page }) => {
      await mockAll(page, { warningStatus: 429 });
      await openApp(page, undefined, '#malaysia');
      await expect(page.locator('#my-warnings')).toContainText('Had permintaan data.gov.my dicapai');
      await expect(page.locator('#my-warnings').getByRole('button', { name: 'Cuba lagi' })).toBeVisible();
    });
  });
});

// js/prayer-calc.js and js/moon.js against values from the ephem astronomy
// library (UTC, to the minute), within what rounding and the formulas allow.
test.describe('pengiraan dalam pelayar: waktu solat dan bulan', () => {
  test('waktu solat ikut kaedah setiap negara, dalam 2 minit daripada ephem', async ({ page }) => {
    await openApp(page);
    const cases = [
      [{ zone: 'Europe/London', lat: 51.51, lon: -0.13 }, '2026-03-20', 'MWL',
        { fajr: '2026-03-20T04:10', syuruk: '2026-03-20T06:03', dhuhr: '2026-03-20T12:08', asr: '2026-03-20T15:25', maghrib: '2026-03-20T18:13', isha: '2026-03-20T20:00' }],
      [{ zone: 'America/New_York', lat: 40.71, lon: -74.01 }, '2026-12-21', 'ISNA',
        { fajr: '2026-12-21T10:54', syuruk: '2026-12-21T12:16', dhuhr: '2026-12-21T16:55', asr: '2026-12-21T19:14', maghrib: '2026-12-21T21:31', isha: '2026-12-21T22:54' }],
      [{ zone: 'Asia/Jakarta', lat: -6.2, lon: 106.85 }, '2026-10-14', 'KEMENAG',
        { fajr: '2026-10-13T21:13', syuruk: '2026-10-13T22:31', dhuhr: '2026-10-14T04:39', asr: '2026-10-14T07:43', maghrib: '2026-10-14T10:45', isha: '2026-10-14T11:55' }],
      // Umm al-Qura: Isyak 90 minutes after Maghrib.
      [{ zone: 'Asia/Riyadh', lat: 21.42, lon: 39.83 }, '2026-06-21', 'UMM_AL_QURA',
        { fajr: '2026-06-21T01:11', syuruk: '2026-06-21T02:39', dhuhr: '2026-06-21T09:23', asr: '2026-06-21T12:42', maghrib: '2026-06-21T16:05', isha: '2026-06-21T17:35' }],
    ];
    const results = await page.evaluate(async (list) => {
      const { prayerTimes } = await import('./js/prayer-calc.js');
      return list.map(([city, iso]) => prayerTimes(city, iso));
    }, cases);
    results.forEach((times, i) => {
      const [city, , method, expected] = cases[i];
      expect(times.method.key, city.zone).toBe(method);
      for (const [field, at] of Object.entries(expected)) {
        expect(Math.abs(times[field] - Date.parse(`${at}Z`)) / 60000, `${city.zone} ${field}`).toBeLessThanOrEqual(2);
      }
    });
  });

  test('waktu solat jauh di utara: tiada waktu yang mustahil, Subuh dan Isyak ikut sudut', async ({ page }) => {
    await openApp(page);
    const [summer, winter, london, saoPaulo] = await page.evaluate(async () => {
      const { prayerTimes, methodFor } = await import('./js/prayer-calc.js');
      const tromso = { zone: 'Europe/Oslo', lat: 69.65, lon: 18.96 };
      return [prayerTimes(tromso, '2026-06-21'), prayerTimes(tromso, '2026-12-21'),
        prayerTimes({ zone: 'Europe/London', lat: 51.51, lon: -0.13 }, '2026-06-21'), methodFor({ zone: 'America/Sao_Paulo', lat: -23.55 }).key];
    });
    // Midnight sun: no sunrise or sunset, so no Subuh, Maghrib or Isyak either.
    expect([summer.fajr, summer.syuruk, summer.maghrib, summer.isha]).toEqual([null, null, null, null]);
    expect(summer.dhuhr).not.toBeNull();
    // Polar night: no sunrise, sunset or Asar shadow.
    expect([winter.syuruk, winter.asr, winter.maghrib]).toEqual([null, null, null]);
    // London never gets 18° dark at midsummer: Subuh is 18/60 of the night before sunrise.
    const night = 24 * 60 - (london.maghrib - london.syuruk) / 60000;
    expect(Math.abs((london.syuruk - london.fajr) / 60000 - (18 / 60) * night)).toBeLessThanOrEqual(1);
    expect(saoPaulo).toBe('MWL'); // the Americas south of 15°N
  });

  test('fasa bulan, anak bulan dan purnama, serta bulan terbit dan terbenam di Kuala Lumpur', async ({ page }) => {
    await openApp(page);
    // [start of the Malaysian day, lit at noon, rise, set, next new moon, next full moon]
    const refs = [
      ['2026-10-13T16:00:00Z', 0.1236, '2026-10-14T01:36', '2026-10-14T13:49', '2026-11-09T07:02', '2026-10-26T04:11'],
      ['2027-02-07T16:00:00Z', 0.0215, '2027-02-08T00:25', '2027-02-08T12:42', '2027-03-08T09:29', '2027-02-20T23:23'],
      ['2027-06-19T16:00:00Z', 0.9877, '2027-06-20T12:33', '2027-06-19T23:55', '2027-07-04T03:01', '2027-07-18T15:44'],
    ];
    const got = await page.evaluate(async (list) => {
      const { moonPhase, moonTimes, nextPhase } = await import('./js/moon.js');
      return list.map(([start]) => {
        const t = Date.parse(start);
        return [moonPhase(t + 12 * 3600000).lit, moonTimes(t, 3.14, 101.69), nextPhase(t, 0), nextPhase(t, 0.5)];
      });
    }, refs);
    const minutes = (ms, at) => Math.abs(ms - Date.parse(`${at}Z`)) / 60000;
    got.forEach(([lit, times, newMoon, fullMoon], i) => {
      const [start, refLit, rise, set, refNew, refFull] = refs[i];
      expect(Math.abs(lit - refLit), start).toBeLessThan(0.01);
      expect(minutes(times.rise, rise), `${start} terbit`).toBeLessThanOrEqual(6);
      expect(minutes(times.set, set), `${start} terbenam`).toBeLessThanOrEqual(6);
      expect(minutes(newMoon, refNew), `${start} bulan baharu`).toBeLessThanOrEqual(8);
      expect(minutes(fullMoon, refFull), `${start} purnama`).toBeLessThanOrEqual(8);
    });
  });
});

// scripts/build-calendars.mjs, as .github/workflows/pages.yml runs it, against
// a stand-in for waktusolat.app and for the published site.
test.describe('kalendar langganan: skrip binaan', () => {
  const http = require('node:http');
  const fs = require('node:fs');
  const path = require('node:path');
  const { execFile } = require('node:child_process');

  // Two days a month for every zone; `failing` zones answer 500, and
  // `onceFailing` ones only to their first request.
  async function standIn(failing, onceFailing = []) {
    const seen = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const zone = url.pathname.match(/^\/v2\/solat\/(\w+)$/)?.[1];
      const firstTry = zone && onceFailing.includes(zone) && !seen.includes(zone);
      if (zone) seen.push(zone);
      if (zone && !failing.includes(zone) && !firstTry) {
        const at = (day, hh, mm) => Date.UTC(Number(url.searchParams.get('year')), Number(url.searchParams.get('month')) - 1, day, hh - 8, mm) / 1000;
        const prayers = [1, 2].map((day) => ({ day, fajr: at(day, 5, 55), syuruk: at(day, 7, 5), dhuhr: at(day, 13, 10), asr: at(day, 16, 20), maghrib: at(day, 19, 12), isha: at(day, 20, 22) }));
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ zone, prayers }));
      } else if (url.pathname === '/laman/kalendar/JHR01.ics') {
        res.writeHead(200, { 'Content-Type': 'text/calendar' }).end('SALINAN-LAMA-JHR01');
      } else {
        res.writeHead(zone ? 500 : 404).end();
      }
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  }

  // Resolves with the exit code and output, whether or not the script fails.
  const build = (base, args) => new Promise((resolve) => {
    execFile(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/build-calendars.mjs', ...args],
      { env: { ...process.env, ZONE_API: base, RETRY_MS: '1' } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

  test('setiap zon mendapat kalendarnya; zon yang gagal kekal dengan salinan yang sudah diterbitkan', async ({}, testInfo) => {
    const { server, base } = await standIn(['JHR01'], ['KTN01']);
    try {
      const out = testInfo.outputPath('kalendar');
      const run = await build(base, [out, '--previous', `${base}/laman/`]);
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toContain('60 calendars in');
      expect(run.stdout).toContain('1 kept from the published site');
      expect(fs.readdirSync(out)).toHaveLength(60);

      const ics = fs.readFileSync(path.join(out, 'WLY01.ics'), 'utf8').replace(/\r\n /g, '');
      expect(ics).toContain('\r\nX-WR-CALNAME:Waktu solat WLY01 (Kuala Lumpur\\, Putrajaya)\r\nREFRESH-INTERVAL;VALUE=DURATION:PT12H\r\n');
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2 * 2 * 5); // this month and the next, two days each, five prayers
      expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(20);
      expect(ics).toMatch(/\r\nSUMMARY:Subuh \(WLY01\)\r\n/);
      expect(fs.readFileSync(path.join(out, 'JHR01.ics'), 'utf8')).toBe('SALINAN-LAMA-JHR01');
      // A request that fails once is tried again, not given up on.
      expect(fs.readFileSync(path.join(out, 'KTN01.ics'), 'utf8').match(/BEGIN:VEVENT/g)).toHaveLength(20);
    } finally {
      server.close();
    }
  });

  test('zon gagal tanpa salinan yang boleh dikekalkan: binaan gagal', async ({}, testInfo) => {
    const { server, base } = await standIn(['JHR01', 'KDH02']);
    try {
      const alone = await build(base, [testInfo.outputPath('tanpa-salinan')]); // no --previous
      expect(alone.code).not.toBe(0);
      expect(alone.stderr).toContain('JHR01: HTTP 500');
      const missing = await build(base, [testInfo.outputPath('salinan-tiada'), '--previous', `${base}/laman/`]);
      expect(missing.code).not.toBe(0);
      expect(missing.stderr).toContain('KDH02: HTTP 500, and no published copy to keep (HTTP 404)');
    } finally {
      server.close();
    }
  });
});

// Direction B (DESIGN.md), plan items P1-P4 and P10.
test.describe('reka bentuk: jalur matahari, perancang, sasaran sentuh, glob kemudian', () => {
  test('jalur matahari: hari bandar dari tengah malam, fasa dalam perkataan', async ({ page }) => {
    await openApp(page); // 06:00:07 Wednesday in Kuala Lumpur
    const kl = card(page, 'Asia/Kuala_Lumpur');
    await expect(kl.getByRole('heading', { name: 'Kuala Lumpur' })).toBeVisible();
    await expect(kl).toHaveAttribute('aria-label', 'Kuala Lumpur');
    await expect(kl.locator('.phase-name')).toHaveText('Fajar'); // not colour alone
    await expect(kl.locator('.sun-strip')).toHaveAttribute('aria-hidden', 'true');
    const strip = await kl.locator('.sun-strip').evaluate((s) => ({
      runs: [...s.querySelectorAll('.sun-runs span')].map((r) => [r.className, parseFloat(r.style.width)]),
      mark: parseFloat(s.querySelector('.sun-now').style.left),
    }));
    expect(strip.runs.map(([phase]) => phase)).toEqual(['night', 'dawn', 'day', 'dusk', 'night']);
    expect(strip.runs.reduce((n, [, w]) => n + w, 0)).toBeCloseTo(100, 3); // widths come back from CSS rounded
    // Day runs from an hour after sunrise to an hour before sunset, as the sun line says.
    const [rise, set] = (await kl.locator('.sun').textContent()).match(/\d\d:\d\d/g).map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    const dayFrom = strip.runs[0][1] + strip.runs[1][1];
    expect(dayFrom).toBeCloseTo(((rise + 60) / 1440) * 100, 0);
    expect(dayFrom + strip.runs[2][1]).toBeCloseTo(((set - 60) / 1440) * 100, 0);
    expect(strip.mark).toBeCloseTo((360 / 1440) * 100, 0); // 06:00
  });

  test('perancang: kategori dibaca, hari bandar yang bertukar ditanda', async ({ page }) => {
    await openApp(page);
    const rows = page.locator('#planner-table tbody tr');
    await expect(rows.nth(0).locator('td').nth(9)).toContainText(', waktu kerja');
    await expect(rows.nth(0).locator('td').nth(23)).toContainText(', waktu tidur');
    // Midnight Wednesday in Kuala Lumpur is 17:00 Tuesday in London; London turns to Wednesday at 07:00 here.
    const london = rows.nth(1).locator('td');
    await expect(london.nth(0)).toHaveAttribute('data-day', 'Sel');
    await expect(london.nth(0)).toContainText(', Selasa');
    await expect(london.nth(7)).toHaveClass(/day-start/);
    await expect(london.nth(7)).toHaveAttribute('data-day', 'Rab');
    await expect(london.nth(6)).not.toHaveClass(/day-start/);
    await expect(london.nth(8)).toHaveClass(/sun-night/); // 01:00 in London
    await expect(rows.nth(0).locator('td').nth(0)).not.toHaveAttribute('data-day'); // your own row starts on the planned day
  });

  test('sasaran sentuh sekurang-kurangnya 44 x 44 px pada telefon', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openApp(page);
    await page.locator('.planner-settings summary').click();
    const small = await page.evaluate(() => [...document.querySelectorAll('#dunia button, #dunia a[href], #dunia input, #dunia select, #dunia summary, header button, header a, header label, .skip-link')]
      .filter((n) => n.offsetParent !== null && !(n.matches('input[type="checkbox"]') && n.closest('label')) && !n.matches('.weather-toggle'))
      .map((n) => { const r = n.getBoundingClientRect(); return { name: n.getAttribute('aria-label') || n.id || n.textContent.trim(), w: r.width, h: r.height }; })
      .filter((t) => t.w < 44 || t.h < 44));
    expect(small).toEqual([]);
  });

  test('label kelihatan, nilai penggelangsar dibaca, pautan langkau ke senarai dan jadual', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('label[for="zone-input"]')).toBeVisible();
    await expect(page.getByLabel('Cari bandar')).toHaveAttribute('id', 'zone-input');
    const slider = page.locator('#time-slider');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Sekarang');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /^\+0j 30m dari sekarang · .+ waktu anda$/); // the sentence, not "2"
    expect(await slider.getAttribute('aria-valuetext')).toBe(await page.locator('#time-label').textContent());
  });

  test('pautan langkau: ke senarai bandar dan ke jadual perancang', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Langkau ke senarai bandar');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Langkau ke jadual perancang');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Pilih 00:00 waktu anda$/);
  });

  test('glob: pustaka peta dimuat hanya bila glob hampir kelihatan', async ({ page }) => {
    const fetched = [];
    page.on('request', (r) => fetched.push(new URL(r.url()).pathname));
    const globeLibraries = () => fetched.filter((p) => /d3-|topojson|land-110m/.test(p));
    await openApp(page);
    expect(globeLibraries()).toEqual([]);
    const before = await page.locator('#globe').evaluate((el) => el.getBoundingClientRect().height);
    await showGlobe(page);
    expect(globeLibraries()).toEqual(['/vendor/d3-array.min.js', '/vendor/d3-geo.min.js', '/vendor/topojson-client.min.js', '/vendor/land-110m.js']);
    expect(await page.locator('#globe').evaluate((el) => el.getBoundingClientRect().height)).toBe(before); // space was kept for it
    await expect(page.locator('#globe-status')).toHaveText('');
  });
});
