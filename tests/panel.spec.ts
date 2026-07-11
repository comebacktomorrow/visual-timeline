import { test, expect } from '@grafana/plugin-e2e';

// The panel ships a built-in demo backend (no API URL configured), so these
// smoke tests assert the real render path with zero external dependencies.

test('timeline mode renders source cards with frames from demo data', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const panel = panelEditPage.panel.locator;
  await expect(panel.locator('.ktl .card').first()).toBeVisible({ timeout: 20000 });
  await expect(panel.locator('.ktl .slot img').first()).toBeVisible();
  await expect(panel.locator('.ktl .axis .tick').first()).toBeVisible();
});

test('multiview grid mode renders tiles from demo data', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  const panel = panelEditPage.panel.locator;
  await expect(panel.locator('.ktl .tile').first()).toBeVisible({ timeout: 20000 });
});
