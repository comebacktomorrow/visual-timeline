import { test, expect } from '@grafana/plugin-e2e';

// What a panel shows when it has nothing to draw
// (provisioning/dashboards/empty-states.json). Neither ever shows demo data.

test('a panel whose query returns data but no frames says what it needs', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  // no data source in the panel JSON: Grafana runs its default (TestData's
  // random walk), which has a time but no image field
  const dashboard = await readProvisionedDashboard({ fileName: 'empty-states.json' });
  await gotoDashboardPage(dashboard);
  const empty = page.getByTestId('vt-empty-state').filter({ hasText: "No frames in this panel's query" });
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(empty).toContainText('Frame fields');
});

test("a panel whose data source was deleted shows Grafana's error, not frames", async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'empty-states.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  await expect(dashboardPage.getPanelByTitle('Deleted data source').getErrorIcon()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ktl .card')).toHaveCount(0);
});
