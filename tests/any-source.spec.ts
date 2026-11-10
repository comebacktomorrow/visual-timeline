import { test, expect } from '@grafana/plugin-e2e';

// The panel reading frame records from a stock data source (#126):
// provisioning/dashboards/any-source.json feeds it TestData CSV rows of time,
// host and image (Base64 SVG data URLs), with no Visual Timeline data source
// involved. cam-a has 10 frames 3 minutes apart; cam-b misses two of them.

test('a timeline draws hosts and frames from a stock data source', async ({ gotoDashboardPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Timeline from TestData');
  const names = panel.locator.locator('.ktl .card .card-head .nm');
  await expect(names).toHaveText(['cam-a', 'cam-b'], { timeout: 20000 });
  // the frames are the rows' own images
  await expect(panel.locator.locator('.ktl .card .strip img[src^="data:image/svg+xml"]').first()).toBeAttached();
  // cam-b's missing frames are a gap, drawn as offline
  const camB = panel.locator.locator('.ktl .card').filter({ has: panel.locator.page().locator('.nm', { hasText: 'cam-b' }) });
  await expect(camB.locator('.slot.gap').first()).toBeAttached();
  // no site in the rows: no empty site chip
  await expect(panel.locator.locator('.ktl .card-head .st:empty')).toHaveCount(0);
});

test('the grid shows each host\'s latest frame from a stock data source', async ({ gotoDashboardPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Grid from TestData');
  await expect(panel.locator.locator('.ktl .tile')).toHaveCount(2, { timeout: 20000 });
  await expect(panel.locator.locator('.ktl .tile img[src^="data:image/svg+xml"]')).toHaveCount(2);
});

test('a state query set to pause frames explains a host\'s missing frames, in its mapped label and colour', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  // the panel is third: tall enough that Grafana renders it without scrolling
  await page.setViewportSize({ width: 1280, height: 1400 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Pauses from TestData');
  const camB = panel.locator.locator('.ktl .card').filter({ has: panel.locator.page().locator('.nm', { hasText: 'cam-b' }) });
  const band = camB.locator('.slot.paused.tinted');
  await expect(band).toHaveCount(1, { timeout: 20000 });
  await expect(band.locator('.band-label')).toHaveText('Maintenance');
  // the frames it didn't send are explained, not offline: its only gap left
  // is the window's last tick, after the last frame (cam-a has the same one)
  await expect(camB.locator('.slot.gap')).toHaveCount(1);
  await expect(camB.locator('.slot').last()).toHaveClass(/\bgap\b/);
  // cam-a has no state: untouched
  const camA = panel.locator.locator('.ktl .card').filter({ has: panel.locator.page().locator('.nm', { hasText: 'cam-a' }) });
  await expect(camA.locator('.slot.paused')).toHaveCount(0);
});

test('a state that runs alongside the frames is drawn on its host like a region annotation', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Pauses from TestData');
  const camA = panel.locator.locator('.ktl .card').filter({ has: panel.locator.page().locator('.nm', { hasText: 'cam-a' }) });
  await expect(camA.locator('.strip .ann-region')).toHaveCount(1, { timeout: 20000 });
  // its frames still show: a state that doesn't pause them leaves them be
  await expect(camA.locator('.slot.paused')).toHaveCount(0);
  await expect(camA.locator('.slot img')).not.toHaveCount(0);
  // the marker's tooltip names the state as its mapping shows it
  await camA.locator('.strip .ann').first().hover();
  await expect(page.locator('.ktl-ann-tip')).toContainText('Cleaning');
});

test('a host table gives hosts their time zone, location and tags, and draws a host with no frames', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Pauses from TestData');
  const card = (host: string) => panel.locator.locator('.ktl .card').filter({ has: page.locator('.nm', { hasText: host }) });
  await expect(card('cam-a').locator('.card-head .tzc')).toContainText('Sydney', { timeout: 20000 });
  await expect(card('cam-a').locator('.card-head > .st:not(.tz)')).toHaveText('lobby');
  await expect(card('cam-a').locator('.card-head .tags')).toContainText('env=prod');
  // only the table knows cam-c: drawn, with nothing but gaps
  await expect(card('cam-c')).toHaveCount(1);
  await expect(card('cam-c').locator('.slot img')).toHaveCount(0);
});

test('an irregular feed holds its last frame, and a longer silence is a neutral gap, not offline', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Irregular feed from TestData');
  const strip = panel.locator.locator('.ktl .card .strip');
  // frames held over the slots between them (10:07 is held until 10:12)
  await expect(strip.locator('.slot.held').first()).toBeAttached({ timeout: 20000 });
  // the silence past the hold (10:12 to 10:19) is "no data", never the red
  // offline hatch: a gap with frames on both sides of it
  const classes = await strip.locator('.slot').evaluateAll((els) => els.map((e) => e.className));
  const mid = classes.findIndex((c, i) => /\bnodata\b/.test(c) && classes.slice(0, i).some((x) => !/gap|beyond/.test(x)));
  expect(mid).toBeGreaterThan(0);
  expect(classes.slice(mid).some((x) => x === 'slot')).toBe(true);
  await expect(strip.locator('.slot.gap:not(.nodata)')).toHaveCount(0);
});

test('header chips are the ones the panel names, and a click follows the chip link', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 2200 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Chips from TestData');
  const head = panel.locator.locator('.ktl .card').filter({ has: page.locator('.nm', { hasText: 'cam-a' }) }).locator('.card-head');
  // only the env tag: no location chip, no other tags
  await expect(head.locator('.st:not(.tz)')).toHaveText(['env=prod'], { timeout: 20000 });
  await head.locator('.st:not(.tz)').click();
  // Grafana adds the dashboard's slug to the path
  await expect(page).toHaveURL(/\/d\/vt-filters\b.*[?&]var-host=cam-a\b/);
});

test('a wide table (an image column per host) draws a strip per column', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  await page.setViewportSize({ width: 1280, height: 2600 });
  const dashboard = await readProvisionedDashboard({ fileName: 'any-source.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Wide table from TestData');
  await expect(panel.locator.locator('.ktl .card .card-head .nm')).toHaveText(['cam-p', 'cam-q'], { timeout: 20000 });
  const camQ = panel.locator.locator('.ktl .card').filter({ has: page.locator('.nm', { hasText: 'cam-q' }) });
  await expect(camQ.locator('.slot.gap')).not.toHaveCount(0);
});
