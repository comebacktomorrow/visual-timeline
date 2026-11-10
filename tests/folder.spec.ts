import { test, expect } from '@grafana/plugin-e2e';

// The HTTP folder connection (#125) against the seeded fixture nginx serves in
// docker-compose.yaml (tests/folder-fixture): two hosts, a frame about every
// 3 minutes with drifting seconds, small and large images, and cam-b missing
// 10:12 and 10:15. Each listing format draws the same timeline.

for (const title of ['Folder with an HTML listing', 'Folder with a JSON listing']) {
  test(`${title}: hosts, frames from the folder, and a missing frame as a gap`, async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    const dashboard = await readProvisionedDashboard({ fileName: 'folder.json' });
    const dashboardPage = await gotoDashboardPage(dashboard);
    const panel = dashboardPage.getPanelByTitle(title);
    await expect(panel.locator.locator('.ktl .card .card-head .nm')).toHaveText(['cam-a', 'cam-b'], { timeout: 20000 });
    // the small images, loaded straight from the folder's published address
    await expect(panel.locator.locator('.ktl .slot img[src^="http://localhost:8098/"]').first()).toBeAttached();
    const camB = panel.locator.locator('.ktl .card').filter({ has: page.locator('.nm', { hasText: 'cam-b' }) });
    await expect(camB.locator('.slot.gap')).not.toHaveCount(0);
  });
}

test('Save & test on a folder says what it found', async ({ readProvisionedDataSource, gotoDataSourceConfigPage, selectors }) => {
  // the fixture's frames are on 2026-01-01, outside the last 24 hours that
  // Save & test reads: the folder and template work, and it says nothing matched
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'Visual Timeline (folder, HTML)' });
  const configPage = await gotoDataSourceConfigPage(ds.uid);
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('error', { hasText: 'no file in the last 24 hours matched' });
});
