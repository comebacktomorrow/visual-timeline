import { test, expect } from '@grafana/plugin-e2e';

// Filtering through the data source (provisioning/dashboards/filters.json,
// the bundled starter dashboard on the demo data source): the Site and Host
// variables, the ad hoc filter bar, and clicking a header chip. Demo data has
// source-1..3 in site-a and source-4..5 in site-b.

const cardNames = (page: import('@playwright/test').Page) =>
  page.locator('.ktl .card .card-head .nm');

test('the Site and Host variables narrow the panels', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams({ 'var-site': 'site-a' }) });
  await expect(cardNames(page)).toHaveText(['source-1', 'source-2', 'source-3'], { timeout: 20000 });

  await gotoDashboardPage({
    ...dashboard,
    queryParams: new URLSearchParams({ 'var-site': 'site-a', 'var-host': 'source-2' }),
  });
  await expect(cardNames(page)).toHaveText(['source-2'], { timeout: 20000 });
});

test('an ad hoc filter narrows the panels', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams({ 'var-Filters': 'host|!=|source-1' }) });
  await expect(cardNames(page)).toHaveText(['source-2', 'source-3', 'source-4', 'source-5'], { timeout: 20000 });
});

test('clicking a header chip adds it to the ad hoc filter', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  await gotoDashboardPage(dashboard);
  await expect(cardNames(page)).toHaveCount(5, { timeout: 20000 });
  await page.locator('.ktl .card-head [data-fk="site"]', { hasText: 'site-b' }).first().click();
  await expect(cardNames(page)).toHaveText(['source-4', 'source-5'], { timeout: 20000 });
  await expect.poll(() => new URL(page.url()).searchParams.getAll('var-Filters')).toContain('site|=|site-b');
});
