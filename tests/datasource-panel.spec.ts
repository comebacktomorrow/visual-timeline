import { test, expect } from '@grafana/plugin-e2e';

// Panels with the Data source option set read /sources and /frames through
// that data source's proxy route. The mock API (tests/mock-api) answers only
// with the token Grafana adds from the data source's secure settings.
const proxied = (uid: string, path: string) => new RegExp(`/api/datasources/proxy/uid/${uid}/api/${path}(\\?|$)`);

// signed image URLs on the API's own host, as the reference worker mints
const IMAGE_HOST = 'https://frames.vt-e2e.invalid';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test('the panel reads the API through the data source proxy, without a key', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'Visual Timeline API (mock)' });
  const dashboard = await readProvisionedDashboard({ fileName: 'datasource-mode.json' });
  const sources = page.waitForResponse((r) => proxied(ds.uid, 'sources').test(r.url()));
  const frames = page.waitForResponse((r) => proxied(ds.uid, 'frames').test(r.url()));
  await gotoPanelEditPage({ dashboard, id: '1' });

  const sourcesResponse = await sources;
  expect(sourcesResponse.status()).toBe(200);
  // the browser's request carries no API credentials: Grafana adds them
  expect(await sourcesResponse.request().headerValue('authorization')).toBeNull();
  expect((await frames).status()).toBe(200);

  await expect(page.locator('.ktl .card .card-head .nm').first()).toHaveText('e2e-cam', { timeout: 20000 });
  await expect(page.locator('.ktl .boot-err')).toHaveCount(0);
});

test("frame images load straight from the API's signed URLs, not through Grafana", async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'Visual Timeline API (mock)' });
  const dashboard = await readProvisionedDashboard({ fileName: 'datasource-mode.json' });

  // the mock API has no frames; answer /frames here with one frame per step,
  // each with an absolute signed URL like the reference worker's
  await page.route(proxied(ds.uid, 'frames'), async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const [from, to, step] = ['from', 'to', 'step'].map((k) => Number(q.get(k)));
    const out = [];
    for (let ts = Math.ceil(from / step) * step; ts <= to && out.length < 500; ts += step) {
      out.push({
        source: q.get('source'),
        ts,
        url: `${IMAGE_HOST}/frame/lo/e2e/e2e-cam/${ts}.jpg?e=4102444800000&sig=e2e`,
      });
    }
    await route.fulfill({ json: out });
  });
  await page.route(`${IMAGE_HOST}/**`, (route) => route.fulfill({ contentType: 'image/png', body: PNG_1X1 }));

  const image = page.waitForRequest((r) => r.url().startsWith(`${IMAGE_HOST}/frame/lo/`));
  await gotoPanelEditPage({ dashboard, id: '1' });

  const url = new URL((await image).url());
  expect(url.searchParams.get('sig')).toBe('e2e');
  expect(url.searchParams.has('k')).toBe(false);
  await expect(page.locator('.ktl .slot img').first()).toHaveAttribute('src', new RegExp(`^${IMAGE_HOST}/frame/lo/`), {
    timeout: 20000,
  });
});

test('a data source whose token the API rejects shows the error in the panel', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'datasource-mode.json' });
  await gotoPanelEditPage({ dashboard, id: '2' });
  // the API's 401 arrives as Grafana's 400 ("Authentication to data source failed")
  await expect(page.locator('.ktl .boot-err')).toContainText('kiosks 400', { timeout: 20000 });
});
