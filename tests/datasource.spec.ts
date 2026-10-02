import { test, expect } from '@grafana/plugin-e2e';

// The Visual Timeline API data source has no backend: Save & test calls the
// API's /sources through Grafana's data source proxy, whose route adds the
// viewer token server-side. docker-compose.yaml starts a mock API
// (tests/mock-api) that answers only with the provisioned token.
const DS_TYPE = 'savvycocoa1919-visualtimeline-datasource';
const MOCK_API = 'http://vt-mock-api';
const sourcesThroughProxy = (uid: string) => `/api/datasources/proxy/uid/${uid}/api/sources`;

test('the provisioned data source reaches the API with the token Grafana adds', async ({
  readProvisionedDataSource,
  gotoDataSourceConfigPage,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'Visual Timeline API (mock)' });
  const configPage = await gotoDataSourceConfigPage(ds.uid);
  const response = await configPage.saveAndTest({ path: sourcesThroughProxy(ds.uid) });
  expect(response.status()).toBe(200);
  await expect(configPage).toHaveAlert('success', { hasText: 'Connected: the API lists 1 source.' });
});

test('a wrong token is reported as rejected by the API', async ({
  readProvisionedDataSource,
  gotoDataSourceConfigPage,
}) => {
  const ds = await readProvisionedDataSource({
    fileName: 'datasources.yml',
    name: 'Visual Timeline API (mock, wrong token)',
  });
  const configPage = await gotoDataSourceConfigPage(ds.uid);
  const response = await configPage.saveAndTest({ path: sourcesThroughProxy(ds.uid) });
  // Grafana's proxy reports an upstream 401 as 400 ("Authentication to data
  // source failed"), so a 401 never logs the browser session out
  expect(response.status()).toBe(400);
  await expect(configPage).toHaveAlert('error', { hasText: 'viewer token' });
});

test('the config page saves the API URL and keeps the token secret', async ({ createDataSourceConfigPage, page }) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  await config.getByRole('textbox', { name: /API URL/ }).fill(MOCK_API);
  await config.getByLabel(/Viewer token/).fill('typed-in-the-ui');

  // the typed token isn't the mock's: the API answers 401, which the proxy
  // reports as 400
  const response = await configPage.saveAndTest({ path: sourcesThroughProxy(configPage.datasource.uid) });
  expect(response.status()).toBe(400);
  await expect(configPage).toHaveAlert('error', { hasText: 'viewer token' });

  // after a reload the URL is back and the token only shows as configured
  await configPage.goto();
  await expect(config.getByRole('textbox', { name: /API URL/ })).toHaveValue(MOCK_API);
  await expect(config.getByRole('button', { name: /Reset/ })).toBeVisible();
  await expect(page.locator('input[value="typed-in-the-ui"]')).toHaveCount(0);
});

test('Save & test without an API URL explains what is missing', async ({
  createDataSourceConfigPage,
  selectors,
  page,
}) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  await expect(page.getByTestId('vt-datasource-config')).toBeVisible();
  // the check fails before any request, so there is no response to wait for
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('error', { hasText: 'Set the API URL' });
});
