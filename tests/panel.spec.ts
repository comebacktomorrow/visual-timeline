import { test, expect } from '@grafana/plugin-e2e';

// The demo data source answers with frame rows (SVG data URLs)
// and its events as an annotation query, so these smoke tests assert the
// real render path with zero external dependencies.

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
  // a frame has loaded: any one, since images load newest first (the first
  // slot's is the last, and a slow runner took longer than 5 s to reach it)
  await expect(page.locator('.ktl .slot img[src]').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.ktl .axis .tick').first()).toBeVisible();
});

test('the demo arrives as rows: SVG frames, the outage as a gap, its events as annotations', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('.ktl .card .strip img[src^="data:image/svg+xml"]').first()).toBeAttached({ timeout: 20000 });
  await expect(page.locator('.ktl .card .slot.gap').first()).toBeAttached();
  await expect(page.locator('.ktl .card .slot.paused').first()).toBeAttached();
  // the dashboard's "Host events" annotation query on the demo data source
  await expect(page.locator('.ktl .ann').first()).toBeAttached();
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

// Demo source-3 declares Australia/Sydney and source-5 Asia/Kathmandu (#68):
// their headers name the zone and its offset from the dashboard's, whatever
// zone the test browser runs in ("Sydney · +10h", or "Sydney" alone).
const ZONE_CHIP = (city: string) => new RegExp(`^${city}( · [+−](\\d+h)?(\\d+m)?)?$`);

test('timeline headers show a demo source\'s declared time zone', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  // .first(): during a remount the core briefly keeps the old view painted
  // while the new one loads (double buffering), so the chip can exist twice
  const chip = page.locator('.ktl .card-head .tz', { hasText: 'Sydney' }).first();
  await expect(chip).toBeVisible({ timeout: 20000 });
  await expect(chip).toHaveText(ZONE_CHIP('Sydney'));
});

test('grid tile headers show a demo source\'s declared time zone', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '2' });
  const chip = page.locator('.ktl .t-head .tz', { hasText: 'Kathmandu' }).first();
  await expect(chip).toBeAttached({ timeout: 20000 });
  await expect(chip).toHaveText(ZONE_CHIP('Kathmandu'));
});
