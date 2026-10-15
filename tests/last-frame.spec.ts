import { test, expect } from '@grafana/plugin-e2e';

// A stock Table panel on the demo data source with the query's Last frame
// switch on (provisioning/dashboards/last-frame.json): each host's last frame
// shows as an image, with its status, and the panel-only history column is
// hidden.

test('a Table shows each host\'s last frame as an image', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'last-frame.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Last frame per host');
  const headers = panel.locator.getByRole('columnheader');
  await expect(headers.filter({ hasText: 'Last frame' })).toBeVisible({ timeout: 20000 });
  await expect(headers.filter({ hasText: 'Status' })).toBeVisible();
  await expect(headers.filter({ hasText: /^history$/ })).toHaveCount(0);
  // five demo hosts, each with a drawn frame
  await expect(panel.locator.locator('img[src^="data:image/"]')).toHaveCount(5);
  // (cell roles differ between Grafana 12.0's table and later ones)
  await expect(panel.locator.getByText('live', { exact: true }).first()).toBeVisible();
});

// The same query in Per host format feeds a Canvas panel with no
// transformation: each element's text binds to "<host> status". (Demo frames
// are data: URLs, which Canvas doesn't load as images, and every demo host is
// live at the range's end, so the image and the status colours are checked
// against a real API, not here; the colours' mapping is unit-tested.)
test('Per host format: a Canvas element shows its host\'s status', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'last-frame.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Last frame per host, on a canvas');
  await expect(panel.locator.getByText('live', { exact: true })).toHaveCount(2, { timeout: 20000 });
});
