import { test, expect } from '@grafana/plugin-e2e';

// The Visual Timeline data source has no backend and calls no API (#126):
// it answers with demo data, and panels read anyone's frames from any data
// source that returns rows of time, image and host.
const DS_TYPE = 'savvycocoa1919-visualtimeline-datasource';

test('the provisioned demo data source passes Save & test', async ({ readProvisionedDataSource, gotoDataSourceConfigPage, selectors }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'Visual Timeline (demo)' });
  const configPage = await gotoDataSourceConfigPage(ds.uid);
  // demo data calls nothing, so there is no response to wait for
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('success', { hasText: 'Demo data is on' });
});

test('without Demo data, Save & test says how panels read frames', async ({
  createDataSourceConfigPage,
  selectors,
  page,
}) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  // the frames API's settings are gone
  await expect(config.getByRole('textbox', { name: /API URL/ })).toHaveCount(0);
  await expect(config.getByText('Your own frames')).toBeVisible();
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('error', { hasText: 'turn on Demo data' });
});

test('turning on Demo data passes Save & test', async ({ createDataSourceConfigPage, selectors, page }) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  // a dispatched click, as React sees a user's: Grafana's Switch keeps its
  // checkbox visually hidden, and on some versions it sits outside the
  // viewport, so even a forced click is refused there
  await config.locator('#vt-demo').dispatchEvent('click');
  await expect(config.getByText('Your own frames')).toHaveCount(0);
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('success', { hasText: 'Demo data is on' });
});
