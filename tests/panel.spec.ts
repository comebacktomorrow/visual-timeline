import { test, expect } from '@grafana/plugin-e2e';

// The panel ships a built-in demo backend (no API URL configured), so these
// smoke tests assert the real render path with zero external dependencies.

test('timeline mode renders source cards with frames from demo data', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  // page-level locators: plugin-e2e's panel.locator test-id doesn't match
  // every Grafana version's edit pane, and there is only one panel here
  await expect(page.locator('.ktl .card').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ktl .slot img').first()).toBeVisible();
  await expect(page.locator('.ktl .axis .tick').first()).toBeVisible();
});

test('multiview grid mode renders tiles from demo data', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(page.locator('.ktl .tile').first()).toBeVisible({ timeout: 20000 });
});
