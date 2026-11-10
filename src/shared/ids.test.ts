import datasourcePluginJson from '../datasource/plugin.json';
import panelPluginJson from '../panel/plugin.json';
import { DATASOURCE_ID, PANEL_ID } from './ids';

test('the ids match the plugin.json files', () => {
  expect(datasourcePluginJson.id).toBe(DATASOURCE_ID);
  // existing dashboards reference the panel by this id: it must never change
  expect(panelPluginJson.id).toBe(PANEL_ID);
  expect(PANEL_ID).toBe('savvycocoa1919-visualtimeline-panel');
});

test('the data source has no proxy route: it calls no API (#126)', () => {
  expect((datasourcePluginJson as { routes?: unknown }).routes).toBeUndefined();
});
