import { test, expect } from '@grafana/plugin-e2e';

// The plugin ships as one app with the panel and the data source nested in
// it. Nothing provisions the app's settings: autoEnabled must turn it on.
const APP_ID = 'savvycocoa1919-visualtimeline-app';
const NESTED = [
  { id: 'savvycocoa1919-visualtimeline-panel', type: 'panel' },
  { id: 'savvycocoa1919-visualtimeline-datasource', type: 'datasource' },
];

test('the app is installed and enabled without any setup', async ({ page }) => {
  const res = await page.request.get(`/api/plugins/${APP_ID}/settings`);
  expect(res.ok()).toBeTruthy();
  const app = await res.json();
  expect(app.type).toBe('app');
  expect(app.enabled).toBe(true);
  // the app declares both nested plugins, which the catalog validator requires
  expect((app.includes || []).map((i: { type: string }) => i.type).sort()).toEqual(['datasource', 'panel']);
});

for (const { id, type } of NESTED) {
  test(`the nested ${type} is registered under its own id`, async ({ page }) => {
    const res = await page.request.get(`/api/plugins/${id}/settings`);
    expect(res.ok()).toBeTruthy();
    const plugin = await res.json();
    expect(plugin.id).toBe(id);
    expect(plugin.type).toBe(type);
  });
}

test("the app's plugin page renders", async ({ gotoAppConfigPage, page }) => {
  await gotoAppConfigPage({ pluginId: APP_ID });
  await expect(page.getByRole('heading', { name: 'Visual Timeline' }).first()).toBeVisible();
});
