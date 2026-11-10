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

test('without a connection, Save & test says how panels read frames', async ({
  createDataSourceConfigPage,
  selectors,
  page,
}) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  await expect(config.getByText('Your own frames')).toBeVisible();
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('error', { hasText: 'Choose a connection' });
});

test('choosing Demo data passes Save & test', async ({ createDataSourceConfigPage, selectors, page }) => {
  const configPage = await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  // the radio itself: Grafana lays its input over the label, and a
  // dispatched click is what React sees, across Grafana versions
  await config.getByRole('radio', { name: 'Demo data' }).dispatchEvent('click');
  await expect(config.getByText('Your own frames')).toHaveCount(0);
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(configPage).toHaveAlert('success', { hasText: 'Demo data is on' });
});

test('choosing HTTP folder shows its settings and checks the template as it is typed', async ({ createDataSourceConfigPage, page }) => {
  await createDataSourceConfigPage({ type: DS_TYPE });
  const config = page.getByTestId('vt-datasource-config');
  // the radio itself: Grafana lays its input over the label, and a
  // dispatched click is what React sees, across Grafana versions
  await config.getByRole('radio', { name: 'HTTP folder' }).dispatchEvent('click');
  await expect(config.locator('#vt-folder-url')).toBeVisible();
  await config.locator('#vt-template').fill('{YYYY}{MM}{DD}.jpg');
  await expect(config.getByText('The path template needs {host}')).toBeVisible();
  await config.locator('#vt-template').fill('{host}/{epoch_ms}.jpg');
  await expect(config.getByText('The path template needs {host}')).toHaveCount(0);
});
