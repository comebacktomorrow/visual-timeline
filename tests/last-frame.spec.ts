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
