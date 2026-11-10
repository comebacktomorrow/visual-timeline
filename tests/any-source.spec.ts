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
