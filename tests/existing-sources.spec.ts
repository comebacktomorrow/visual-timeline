import { test, expect } from '@grafana/plugin-e2e';

// The panel reading the fixture frames from stock data sources (M5): rows in
// PostgreSQL and log lines in Loki (docker-compose.yaml, tests/folder-fixture).
// No Visual Timeline data source is involved.

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
});

test('PostgreSQL: frames from a table, and a pause from a table of states', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'existing-sources.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('From PostgreSQL');
  await expect(panel.locator.locator('.ktl .card .card-head .nm')).toHaveText(['cam-a', 'cam-b'], { timeout: 20000 });
  await expect(panel.locator.locator('.ktl .slot img[src^="http://localhost:8098/"]').first()).toBeAttached();
  // cam-b's missing frames are its maintenance, from the states table
  const camB = panel.locator.locator('.ktl .card').filter({ has: page.locator('.nm', { hasText: 'cam-b' }) });
  await expect(camB.locator('.slot.paused.tinted .band-label')).toHaveText('Maintenance');
});

test('Loki: log lines that are image URLs, with the host extracted from their labels', async ({ gotoDashboardPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'existing-sources-loki.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('From Loki');
  await expect(panel.locator.locator('.ktl .card .card-head .nm')).toHaveText(['cam-a', 'cam-b'], { timeout: 20000 });
  await expect(panel.locator.locator('.ktl .slot img[src^="http://localhost:8098/"]').first()).toBeAttached();
});
