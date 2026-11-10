import datasourcePluginJson from '../datasource/plugin.json';
import panelPluginJson from '../panel/plugin.json';
import { DATASOURCE_ID, PANEL_ID } from './ids';
import { FOLDER_ROUTE } from '../datasource/folder/source';

test('the ids match the plugin.json files', () => {
  expect(datasourcePluginJson.id).toBe(DATASOURCE_ID);
  // existing dashboards reference the panel by this id: it must never change
  expect(panelPluginJson.id).toBe(PANEL_ID);
  expect(PANEL_ID).toBe('savvycocoa1919-visualtimeline-panel');
});

test('the data source\'s only proxy route is the HTTP folder (#125): GET only, its URL and token from settings', () => {
  const routes = (datasourcePluginJson as { routes?: Array<{ path: string; method: string; url: string; headers: unknown[] }> }).routes!;
  expect(routes.map((r) => [r.path, r.method, r.url])).toEqual([[FOLDER_ROUTE, 'GET', '{{ .JsonData.folderUrl }}']]);
  expect(routes[0].headers).toEqual([{ name: 'Authorization', content: '{{ if .SecureJsonData.bearerToken }}Bearer {{ .SecureJsonData.bearerToken }}{{ end }}' }]);
});
