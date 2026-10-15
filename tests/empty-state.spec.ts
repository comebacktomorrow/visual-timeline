import { test, expect } from '@grafana/plugin-e2e';

// A panel never falls back to demo data: with no data source selected, or a
// deleted one, it says so (provisioning/dashboards/empty-states.json). The
// dev environment provisions several Visual Timeline data sources, none of
// them Grafana's default, so nothing is picked automatically.

test('a panel with no data source asks for one instead of showing demo data', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'empty-states.json' });
  await gotoDashboardPage(dashboard);
  const empty = page.getByTestId('vt-empty-state').filter({ hasText: 'No data source selected' });
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(empty).toContainText('Data source option');
});

test('a panel whose data source was deleted says so', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'empty-states.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.getByTestId('vt-empty-state').filter({ hasText: 'no longer exists' })).toBeVisible({
    timeout: 20000,
  });
  // and neither panel drew frames
  await expect(page.locator('.ktl .card')).toHaveCount(0);
});
