import { test, expect } from '@grafana/plugin-e2e';

// The core's built-in palette is dark; the panel replaces it with one built
// from Grafana's active theme. userPreferences is worker-scoped, so the
// light-theme run lives in its own file.
test.use({ userPreferences: { theme: 'light' } });

const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) || []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

test('timeline follows Grafana\'s light theme', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  grafanaVersion,
  page,
}) => {
  test.skip(parseInt(grafanaVersion, 10) < 11, 'userPreferences needs Grafana 11+');
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '1' });
  const card = page.locator('.ktl .card').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  // light cards with dark text, not the dark default palette
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  const fg = await card.locator('.card-head .nm').evaluate((el) => getComputedStyle(el).color);
  expect(luminance(bg)).toBeGreaterThan(0.8);
  expect(luminance(fg)).toBeLessThan(0.4);
});

test('grid follows Grafana\'s light theme', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  grafanaVersion,
  page,
}) => {
  test.skip(parseInt(grafanaVersion, 10) < 11, 'userPreferences needs Grafana 11+');
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoPanelEditPage({ dashboard, id: '2' });
  const tile = page.locator('.ktl .tile').first();
  await expect(tile).toBeVisible({ timeout: 20000 });
  const bg = await tile.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(luminance(bg)).toBeGreaterThan(0.8);
});
